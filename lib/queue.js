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
    self.client.lpush(helpers.key(self.name+':queued'), job.id, function(err, added){
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

Queue.prototype.jamGuard = function(idleTime) {
  var self = this;
  debug('Checking for jammed jobs...');
  this.clearJammedJobs(idleTime, function(){
    setTimeout(self.jamGuard.bind(self, idleTime), idleTime*1000 || 1000);
  });
};

Queue.prototype.clearJammedJobs = function(idleTime, cb) {
  var self = this;
  this.fetchJammedJobs(idleTime, function(err, members){
    if(err || !members){
      return cb();
    }

    members.forEach(function(jobID){
      var job = new Job(jobID);
      var worker = new Worker(self, job);
      worker.notProcessing();
    });

    return cb(err, members);
  });
};

/*
  Sometimes, jobs can get stuck in processing state.
  This can happen if a worker dies before acking with processing success/failure, or never invokes the processed callback.

  When given a reasonable idle time after which a job can be considered jammed,
  we can fetch a list of jammed jobs.
*/
Queue.prototype.fetchJammedJobs = function(idleTime, cb) {
  var now = helpers.time();
  var range = now - idleTime;
  this.client.zrangebyscore(helpers.key(this.name+':processing'), 0, range, function(err, members){
    if(err)
      debug(err);

    return cb(err, members);
  });
};

/**
* Detaches the blocking queue consumer by closing the redis client
*/
Queue.prototype.close = function() {
  this.client.end();
};