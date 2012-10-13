var Queue = require('./queue');
var Job = require('./job');
var Worker = require('./worker');
var redis = require('./redis');

exports.redis = redis;

exports.createQueue = function(name, opts){
  if(!opts)
    opts = {};
  
  if(typeof opts.redis == 'undefined'){
    opts.redis = redis;
  }

  var q = new Queue(name, opts);
  return q;
};

exports.Job = Job;
exports.Worker = Worker;