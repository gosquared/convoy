var should = require('should');
var redis = require('redis');
var Convoy = require('../lib/convoy');
var config = require('config');
var helpers = require('../lib/helpers');

var client;

before(function(done){
  client = redis.createClient();
  client.select(config.redis.database);
  client.flushdb(done);
});

describe('Setting up a queue', function(){
	it('Sets up queue object', function(done){
		var q = Convoy.createQueue('rollin');
    done();
	});

  it('Can override redis client', function(done){
    Convoy.redis.createClient = function(){
      client.testProperty = 'cheese';
      return client;
    };

    var q = Convoy.createQueue('rawhide');
    q.client.testProperty.should.equal('cheese');
    done();
  });
});

describe('Enqueing jobs', function(done){
  it('places the job in the queued set', function(done){
    var q = Convoy.createQueue('q');
    var job = new Convoy.Job(1);
    q.addJob(job, function(){
      client.lrange(helpers.key(q.name+':queued'), 0, -1, function(err, list){
        should.not.exist(err);
        list.should.include(''+job.id);
        done();
      });
    });
  });
});

describe('Processing jobs', function(){
  var q, job, processed;
  before(function(done){
    q = Convoy.createQueue('q');
    q.process(function(j, p){
      job = j, processed = p;
      done();
    });
  });

  it('invokes callback with job', function(done){
    job.id.should.equal('1');
    done();
  });

  it('removes job from queued list', function(done){
    client.lrange(helpers.key(q.name+':queued'), 0, -1, function(err, list){
      should.not.exist(err);
      list.should.not.include(''+job.id);
      done();
    });
  });

  it('places job in processing list with timestamp', function(done){
    client.zscore(helpers.key(q.name+':processing'), job.id, function(err, timestamp){
      should.not.exist(err);
      should.exist(timestamp);
      timestamp.should.be.within(helpers.time() - 5, helpers.time());
      done();
    });
  });

  it('places job in fail list if callback invoked with error', function(done){
    processed('ohnoes, something went wrong', function(){
      client.zscore(helpers.key(q.name+':failed'), job.id, function(err, numFails){
        should.not.exist(err);
        should.exist(numFails);
        numFails.should.equal(''+job.id);
        done();
      });
    });
  });
});