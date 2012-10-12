var Queue = require('./queue');
var Job = require('./job');
var Worker = require('./worker');
var redis = require('./redis');

exports.redis = redis;

exports.createQueue = function(name){
  var q = new Queue(name);
  q.client = exports.redis.createClient();
  q.workerClient = exports.redis.createClient();
  return q;
};

exports.Job = Job;
exports.Worker = Worker;