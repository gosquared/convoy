var debug = require('debug')('convoy:worker');
var helpers = require('./helpers');

var Worker = function(queue, job){
  this.queue = queue;
  this.client = queue.workerClient;
  if(job)
    this.job = job;
};

module.exports = Worker;

Worker.prototype.start = function(fn) {
  var self = this;

  self.processing(function(err){
    if(err){
      return self.processed(err);
    }

    // Invoke user's job-processing function
    return fn(self.job, self.processed.bind(self));
  });
};

Worker.prototype.processing = function(cb) {
  var key = helpers.key(this.queue.name+':processing');
  this.client.zadd(key, helpers.time(), this.job.id, cb);
};

/*
  Job is no longer in processing state, because it failed or completed
*/
Worker.prototype.notProcessing = function(cb) {
  this.client.multi()
    .zrem(helpers.key(this.queue.name+':processing'), this.job.id)
    .srem(helpers.key(this.queue.name+':committed'), this.job.id)
    .exec(cb);
};

/*
  Invoked at end of user processing
*/
Worker.prototype.processed = function(err, cb) {
  if(err)
    return this.fail(err, cb);

  // If job completes without error, remove it from processing
  this.notProcessing(function(err){
    if(err){
      return debug(err);
    }

    if(cb)
      cb();

    // TODO: perhaps have an option to maintain a list of completed jobs
  });
};

Worker.prototype.fail = function(jobError, cb) {
  var self = this;
  if(!cb)
    cb = function(){};
  // Job has failed, remove it from processing and add it to failed
  this.notProcessing(function(err){
    self.client.zincrby(helpers.key(self.queue.name+':failed'), 1, self.job.id, function(err, res){
      if(err)
        return debug(err);

      self.logError(jobError, cb);
    });
  });
};

Worker.prototype.logError = function(message, cb) {
  var now = helpers.time();
  var dayStart = now - (now % 86400);
  var key = helpers.key(this.queue.name+':errorLog.'+dayStart);
  this.client.multi()
    .lpush(key, message)
    .expire(key, 86400)
    .exec(cb);
};