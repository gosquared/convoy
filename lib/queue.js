var util = require('util');
var config = require('../config');
var helpers = require('./helpers');
var Job = require('./job');
var Worker = require('./worker');
var debug = require('debug')('convoy:queue');

var prefix = config.keys.prefix;

var Queue = function(name, opts){
  this.name = name;
  this.opts = {
    concurrentWorkers: 1,
    jobTimeout: 5000,
    blockingTimeout: 1
  };

  for(var optionName in opts){
    this.opts[optionName] = opts[optionName];
  }

  this.redisClients = {
    queueClient: opts.redis.createClient(),
    workerClient: opts.redis.createClient()
  };

  // The queue client is used for blocking redis commands
  this.queueClient = this.redisClients.queueClient;
  this.client = this.redisClients.workerClient;
  this.workerClient = this.redisClients.workerClient;

  this.processing = true;
  this.workersRunning = 0;
  this.jobsRunning = 0;
  this.closed = false;
};

module.exports = Queue;

Queue.prototype.addJob = function(job, cb){
  var self = this;
  if(!cb) cb = function(){};

  // Set job in committed list
  this.client.sadd(helpers.key(this.name+':committed'), job.id, function(err, added){
    if(err) return cb(err);

    if(!added){
      // Job is already in the system so we won't try to queue it. It could be queued or processing
      // It's tempting to just zscore the processing list, but that's not atomic and there is a chance
      // that the job is with a worker, but hasn't yet been added to the processing set before we might try queuing it again
      debug('job already committed');
      // We'll still zscore the processing list to find out whether the job's being processed
      return self.client.zscore(helpers.key(self.name+':processing'), job.id, function(err, score){
        var msg = 'committed';
        if(score) msg = 'processing';
        // If the job is in processing state, the client might want to re-queue the job at a later date when it finishes, so call back with a status
        return cb(err, msg);
      });
    }

    // Queue job
    self.client.rpush(helpers.key(self.name+':queued'), job.id, function(err, added){
      if(err) return cb(err);

      return cb(err, added);
    });
  });
};

Queue.prototype.startProcessing = function(cb) {
  var self = this;
  self.processing = true;

  self.processJob(cb);
};

/**
 * Checks if we should fetch a job from the queue based on concurrency settings
 * Fetches the job, spawns a worker and passes the job to the worker
 * @param  {Function} usrCb User function to invoke with job
 */
Queue.prototype.processJob = function(usrCb) {
  var self = this;

  // Only proceed with fetching the job if in processing more and within concurrency limit
  if(!self.processing) return;
  if(self.workersRunning >= self.opts.concurrentWorkers) return;

  self.workersRunning += 1;

  self.fetchJob(function(err, job){
    if(err){
      debug('Failed to fetch job');
      self.endWorker();
      return setTimeout(function(){
        self.processJob(usrCb);
      }, 1000);
    }

    if(!job){
      // BLPOP succeeded but yielded no data (timeout probably reached)
      self.endWorker();
      // Try processing another job
      return self.processJob(usrCb);
    }

    self.spawnWorker(job, function(err, worker){
      // Grab more jobs
      self.processJob(usrCb);

      // Worked failed to start up
      if(err){
        debug('Worker failed to start up');
        self.endWorker(worker);
        // Try processing another job
        return self.processJob(usrCb);
      }

      var usrDone = function(err, workerCb){
        worker.processed(err, workerCb);
        self.endWorker(worker);
        self.processJob(usrCb);
      };

      var jobTimeout;
      var jobTTL = self.opts.jobTimeout;
      var timeoutHit = false;

      if(jobTTL > 0) {
        // Set up a timeout in case the user function never calls back to us
        jobTimeout = setTimeout(function(){
          debug('Warning: Queue processing function did not call done() within %dms. Job is now considered failed.', jobTTL);
          timeoutHit = true;
          return usrDone('timeout');
        }, jobTTL);
      }

      // Pass job to user function + run
      return usrCb(job, function(err, workerCb){
        // If we've already failed this job due to the timeout being reached, and the user function finally
        // calls this job completion callback, then don't continue
        if(!workerCb) workerCb = function(){};
        if(timeoutHit) return workerCb('timeout');
        if(jobTimeout) clearTimeout(jobTimeout);
        return usrDone(err, workerCb);
      });
    });
  });
};

Queue.prototype.spawnWorker = function(job, cb) {
  var self = this;
  var workerTTL = 1000;
  var worker = new Worker(self, job);
  return worker.start(function(err){
    return cb(err, worker);
  });
};

Queue.prototype.endWorker = function() {
  var self = this;
  self.workersRunning -= 1;
};

Queue.prototype.stopProcessing = function() {
  // If blocked, client will still invoke its fetchJob callback with a job
  // once it is released from blpop, but will not go back into blocking state
  // again until startProcessing is called.

  this.processing = false;
};

Queue.prototype.fetchJob = function(cb){
  var self = this;

  var key = helpers.key(this.name+':queued');
  this.blocked = true;
  this.queueClient.blpop(key, self.opts.blockingTimeout, function(err, entry){
    self.blocked = false;
    if(err) return cb(err);

    if(!entry){
      // No jobs to fetch
      return cb();
    }

    var jobID = entry[1];
    var job = new Job(jobID);
    return cb(err, job);
  });
};

Queue.prototype.countQueued = function(cb){
  var key = helpers.key(this.name+':queued');
  this.client.llen(key, cb);
};

Queue.prototype.countCommitted = function(cb){
  var key = helpers.key(this.name+':committed');
  this.client.scard(key, cb);
};

Queue.prototype.countProcessing = function(cb){
  var key = helpers.key(this.name+':processing');
  this.client.zcard(key, cb);
};

Queue.prototype.countFailed = function(cb){
  var key = helpers.key(this.name+':failed');
  this.client.zcard(key, cb);
};

Queue.prototype.jamGuard = function(idleTime, cb) {
  var self = this;
  debug('Checking for jammed jobs...');
  this.clearJammedJobs(idleTime, function(err, jammedJobs){
    self.jamGuardTimeout = setTimeout(self.jamGuard.bind(self, idleTime, cb), idleTime*1000 || 1000);

    if(cb){
      cb(err, jammedJobs);
    }
  });
};

Queue.prototype.clearJammedJobs = function(idleTime, cb) {
  var self = this;

  /**
    Multiple convoys could have set jam guards, so we lock before we clear anything
    to prevent more than one guard from completing the task
  */
  this.setLock('clearJammedJobs', 5, function(err, lockSet, lockKey){
    if(err) return cb(err);

    if(!lockSet){
      debug('another convoy is clearing jammed jobs');
      return cb(null, []);
    }

    self.fetchJammedJobs(idleTime, function(err, members){
      if(err || !members){
        return cb(null, []);
      }

      var jammedJobs = [], pending = 0;

      var iterator = function(){
        if(!--pending){
          self.unlock(lockKey);
        }
      };

      members.forEach(function(jobID){
        pending += 1;
        var job = new Job(jobID);
        jammedJobs.push(job);
        var worker = new Worker(self, job);
        worker.notProcessing(iterator);
      });

      return cb(err, jammedJobs);
    });
  });
};

/*
  Sometimes, jobs can get stuck in processing state.
  This can happen if a worker dies before acking with processing success/failure, or never invokes the processed callback.

  When given a reasonable idle time after which a job can be considered jammed,
  we can fetch a list of jammed jobs.
*/
Queue.prototype.fetchJammedJobs = function(idleTime, cb) {
  var self = this;
  var now = helpers.time();
  var range = Math.round(now - idleTime);

  self.client.zrangebyscore(helpers.key(self.name+':processing'), 0, range, function(err, members){
    if(err) debug(err);

    return cb(err, members);
  });
};

Queue.prototype.setLock = function(name, expire, cb) {
  var expireCommand = 'expire';
  var timestamp = helpers.time();
  timestamp -= timestamp % expire;
  var key = helpers.key(this.name+':lock:'+name+':'+timestamp);
  var rd = this.client.multi();
  rd.setnx(key, timestamp, function(err, lockSet){
    if(err) return cb(err);

    return cb(err, +lockSet, key);
  });
  rd.expire(key, expire);
  rd.exec();
  return key;
};

Queue.prototype.unlock = function(key, cb) {
  this.client.del(key, cb);
};

/*
 * Try to cleanly close clients after all commands are sent
 * When finished closing, the queue object should no longer be used
 *
 * If the queue client is blocked with a pending blpop command, this will not run
 * until the connection is unblocked.
*/
Queue.prototype.close = function(cb) {
  var self = this;
  if(self.closed) return cb();

  self.stopProcessing();
  self.queueClient.quit(function(err){
    self.closed = true;
    return cb(err);
  });
};

/**
* Forces redis connections to close
*/
Queue.prototype.end = function() {
  for(var i in this.redisClients){
    if(!this.redisClients[i]) continue;

    var client = this.redisClients[i];
    client.quit();
  }
};
