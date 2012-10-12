var util = require('util');
var config = require('config');
var helpers = require('./helpers');

var prefix = config.keys.prefix;

var Queue = function(name, opts){
	this.name = name;
};

module.exports = Queue;

Queue.prototype.addJob = function(job, cb){
  var self = this;

	// Check job in processing list
  this.client.zscore(helpers.key('processing'), job.id, function(err, score){
    if(err)
      return cb(err);
    if(score !== null)
      return cb('processing');

    // If not then queue it
    self.client.sadd(helpers.key('queued'), job.id, function(err, added){
      if(err)
        return cb(err);

      cb(null, added);
    });
  });
};