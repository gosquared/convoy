var util = require('util');
var config = require('../config');
var helpers = require('./helpers');
var Job = require('./job');
var Worker = require('./worker');
var debug = require('debug')('convoy:queue');

var prefix = config.keys.prefix;

var Queue = function(name, opts){
  this.name = name;
  this.opts = opts;

  this.redisClients = {
    queueClient: opts.redis.createClient(),
    workerClient: opts.redis.createClient()
  };

  // The queue client is used for blocking redis commands
  this.queueClient = this.redisClients.queueClient;
  this.client = this.redisClients.workerClient;
  this.workerClient = this.redisClients.workerClient;

  this.processing = true;
};

module.exports = Queue;

Queue.prototype.addJob = function(job, cb){
  var self = this;
  if(!cb)
    cb = function(){};

    job.Encode();

  // Set job in committed list
  this.client.sadd(helpers.key(this.name+':committed'), JSON.stringify(job), function(err, added){
    if(err)
      return cb(err);

    if(!added){
      // Job is already in the system so we won't try to queue it. It could be queued or processing
      // It's tempting to just zscore the processing list, but that's not atomic and there is a chance
      // that the job is with a worker, but hasn't yet been set in the processing set when we try to queue it again.
      debug('job already committed');
      return cb('committed');
    }

    // Queue job
    self.client.rpush(helpers.key(self.name+':queued'), JSON.stringify(job), function(err, added){
      if(err)
        return cb(err);

      cb(null, added);
    });
  });
};

Queue.prototype.startProcessing = function(fn) {
  this.processing = true;

  this.process(fn);
};

/*
  Spawn a worker for each job
*/

Queue.prototype.process = function(fn){
  var self = this;

  // Check if we're still meant to be processing the queue before entering blocked state
  if(!self.processing)
    return;

  this.fetchJob(function(err, job){
    var worker = new Worker(self, job);
    worker.start(fn);

    self.process(fn);
  });
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
    this.queueClient.blpop(key, 0, function(err, entry){
    self.blocked = false;
    if(err)
        return cb(err);
        var jobData = entry[1];
        if (jobData === null) {
            return cb();
        }
        var jobData = JSON.parse(jobData);
        var job = new Job(jobData.id);
        job.setRawMethod(jobData.func);
        return cb(null, job);
    });
};

Queue.prototype.countQueued = function(cb){
  var key = helpers.key(this.name+':queued');
  this.client.llen(key, cb);
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
    setTimeout(self.jamGuard.bind(self, idleTime, cb), idleTime*1000 || 1000);

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
  this.setLock('clearJammedJobs', 5, function(err, lockSet){
    if(err)
      return cb(err);

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
          self.unlock('clearJammedJobs');
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
    if(err)
      debug(err);

    return cb(err, members);
  });
};

Queue.prototype.setLock = function(name, expire, cb) {
  var expireCommand = 'expire';
  if(expire < 1)
    expireCommand = 'pexpire';

  var key = helpers.key(this.name+':lock:'+name);
  var rd = this.client.multi();
  rd.setnx(key, helpers.time(), cb);
  rd[expireCommand](key, expire);
  rd.exec();
};

Queue.prototype.unlock = function(name, cb) {
  var key = helpers.key(this.name+':lock:'+name);
  this.client.del(key, cb);
};

/*
 * Try to cleanly close clients after all commands are sent
 * When finished closing, the queue object should no longer be used
*/
Queue.prototype.close = function(cb) {
  if(!cb)
    cb = function(){
      debug('All redis clients closed');
    };

  var pendingClients = Object.keys(this.redisClients).length;
  var done = function(){
    if(!--pendingClients)
      cb();
  };

  // When we are blocked, we're waiting for redis to send a response, so must terminate the client
  if(this.queueClient){
    if(this.blocked){
      this.queueClient.end();
      done();
    }
    else
      this.queueClient.quit(done);
  }
  else
    done();

  for(var i in this.redisClients){
    if(i == 'queueClient')
      continue;

    if(!this.redisClients[i]){
      done();
      continue;
    }

    var client = this.redisClients[i];
    client.quit(done);
  }
};

/**
* Forces redis connections to close
*/
Queue.prototype.end = function() {
  for(var i in this.redisClients){
    if(!this.redisClients[i])
      continue;
    var client = this.redisClients[i];
    client.quit();
  }
};