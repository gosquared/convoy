var util = require('util');
var config = require('../config');
var helpers = require('./helpers');
var Job = require('./job');
var Worker = require('./worker');
var debug = require('debug')('convoy:queue');

var prefix = config.keys.prefix;

var Queue = function(name, opts){
  this.name = name;
};

module.exports = Queue;

Queue.prototype.addJob = function(job, cb){
  var self = this;
  if(!cb)
    cb = function(){};

  // Set job in committed list
  this.client.sadd(helpers.key(this.name+':committed'), job.id, function(err, added){
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
    self.client.rpush(helpers.key(self.name+':queued'), job.id, function(err, added){
      if(err)
        return cb(err);

      cb(null, added);
    });
  });
};

/*
  Spawn a worker for each job
*/

Queue.prototype.process = function(fn){
  var self = this;

  this.fetchJob(function(err, job){
    var worker = new Worker(self, job);
    worker.start(fn);
    self.process(fn);
  });
};

Queue.prototype.fetchJob = function(cb){
  var key = helpers.key(this.name+':queued');
  this.client.blpop(key, 0, function(err, entry){
    if(err)
      return cb(err);

    var jobID = entry[1];
    if(jobID === null){
      // No jobs to fetch
      return cb();
    }
    var job = new Job(jobID);
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

/**
* Detaches the blocking queue consumer by closing the redis client
*/
Queue.prototype.close = function() {
  this.client.end();
};