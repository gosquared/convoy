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
      client.sismember(helpers.key('queued'), job.id, function(err, isMember){
        should.not.exist(err);
        should.exist(isMember);
        isMember.should.equal(1);
        done();
      });
    });
  });
});