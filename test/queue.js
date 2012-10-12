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
      var client = redis.createClient();
      client.select(config.redis.database);
      client.testProperty = 'cheese';
      return client;
    };

    var q = Convoy.createQueue('rawhide');
    q.client.testProperty.should.equal('cheese');
    done();
  });
});

describe('Enqueing jobs', function(done){
  var q, job;
  before(function(done){
    q = Convoy.createQueue('q');
    job = new Convoy.Job(1);
    q.addJob(job, done);
  });

  it('places the job in the committed set', function(done){
    client.sismember(helpers.key(q.name+':committed'), job.id, function(err, isMember){
      should.not.exist(err);
      should.exist(isMember);
      isMember.should.equal(1);
      done();
    });
  });

  it('places the job in the queued list', function(done){
    client.lrange(helpers.key(q.name+':queued'), 0, -1, function(err, list){
      should.not.exist(err);
      list.should.include(''+job.id);
      done();
    });
  });
});

describe('Processing jobs', function(){
  var q, job, processed;
  before(function(done){
    q = Convoy.createQueue('q');
    var returned = false;
    var cb = function(j, p){
      job = j, processed = p;
      done();
      q.close();
    };
    q.process(cb);
  });

  it('invokes callback with job', function(done){
    job.id.should.equal('1');
    done();
  });

  it('removes job from queued list', function(done){
    client.lrange(helpers.key(q.name+':queued'), 0, -1, function(err, list){
      should.not.exist(err);
      should.exist(list);
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

  var errorMsg = 'holy crickets Watman, what happened?';

  it('places job in fail list if callback invoked with error', function(done){
    processed(errorMsg, function(){
      client.zscore(helpers.key(q.name+':failed'), job.id, function(err, numFails){
        should.not.exist(err);
        should.exist(numFails);
        numFails.should.equal(''+job.id);
        done();
      });
    });
  });

  it('failed jobs with error message should get logged', function(done){
    var now = helpers.time();
    var dayStart = now - (now % 86400);
    var key = helpers.key(q.name+':errorLog.'+dayStart);
    client.lrange(key, 0, -1, function(err, log){
      should.not.exist(err);
      should.exist(log);
      log.should.include(errorMsg);
      done();
    });
  });

  it('failed log should have ttl', function(done){
    var now = helpers.time();
    var dayStart = now - (now % 86400);
    var key = helpers.key(q.name+':errorLog.'+dayStart);
    client.ttl(key, function(err, ttl){
      should.not.exist(err);
      should.exist(ttl);
      ttl.should.be.within(0, config.keys.logTTL);
      done();
    });
  });
});

describe('When multiple convoys process the same queue', function(){
  var numConvoys = 10, queues = [], jobIDs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  var committedIDs = [];

  function setUpConvoy(queues){
    var c = Convoy.createQueue('q');
    queues.push(c);
  }


  before(function(done){
    for(var i = numConvoys; i--;){
      setUpConvoy(queues);      
    }

    var pending = queues.length * jobIDs.length;

    function iterator(){
      if(!--pending)
        done();
    }

    queues.forEach(function(queue, i){
      for(var i = jobIDs.length; i--;){
        var job = new Convoy.Job(jobIDs[i]);
        queue.addJob(job, iterator);
      }
    });
  });

  it('they should only queue each unique job once', function(done){
    client.llen(helpers.key(queues[0].name+':queued'), function(err, length){
      should.not.exist(err);
      should.exist(length);
      length.should.equal(jobIDs.length);
    });
    done();
  });
});

describe('stats', function(){
  function testCount(done, err, count){
    should.not.exist(err);
    should.exist(count);
    count.should.be.a('number');
    done();
  }
  it('can count queued', function(done){
    var q = Convoy.createQueue('q');
    q.countQueued(testCount.bind(this, done));
  });
  it('can count processing', function(done){
    var q = Convoy.createQueue('q');
    q.countProcessing(testCount.bind(this, done));
  });
  it('can count failed', function(done){
    var q = Convoy.createQueue('q');
    q.countFailed(testCount.bind(this, done));
  });
});