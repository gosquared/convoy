## Convoy

Convoy is a Node.JS module for creating job queues, publishing jobs to them, and consuming jobs from them using any number of workers running on any number of servers. It is designed as a centralised message bus through which you can connect loosely coupled applications that need to break up and delegate their workload across multiple workers on potentially many different machines.

Convoy uses Redis as its storage medium.

#### Jobs
In Convoy, jobs are simply unique IDs. Each unique ID can only exist once within the queue. When a job is published to a queue, convoy first checks if has already been added to the queue. This is done via the committed list. If the job ID exists in the committed list then it has already been published and will be discarded. Otherwise, it is added to the committed list and enqueued.

Once the job is processed it is removed from the committed list and can be queued again.

### Installation
    npm install redis-convoy

##### Options

* **Concurrent workers**: Maximum number of jobs that can be processing at the same time
* **Job Timeout**: If your function takes more than this time to process a job, the job will be marked as failed

Example:
```javascript
var opts = {
  concurrentWorkers: 10, // Spawn up to a maximum of 10 concurrent workers
  jobTimeout: 2000 // If a worker does not finish within this time (in ms), its job will be considered failed
};
```

### Usage

```javascript
var Convoy = require('redis-convoy');

// Set up options
var opts = {
  concurrentWorkers: 10,
  jobTimeout: 2000
};

// Create a queue object
var q = Convoy.createQueue('monsterTrucks', opts);

// Set up our job. Each job must have an ID
var jobID = 1;
var job = new Convoy.Job(jobID);

// Queue the job, only if a job with the same ID already exists in the queue
q.addJob(job);

// Set up a worker
q.processJob(function(job, done){
  console.log(job);
  done(); // or done('an error') if error during processing of the job
});

// Clear out jammed jobs
q.jamGuard(5, function(err, jammedJobs){
  console.log(jammedJobs);
});

// Run off some queue stats
var logCounter = function(err, count){
  console.log(count);
};

q.countQueued(logCounter);
q.countCommitted(logCounter);
q.countProcessing(logCounter);
q.countFailed(logCounter);
```

### Definitions

 Term                  | Description
-----------------------|------------
 **Queue**             | A Redis list containing unique job IDs
 **Committed list**    | A Redis set containing unnique job IDs. Ensures each job is only queued once
 **Processing list**   | A Redis zset containing job ID as member and the unix timestamp of when the job started processing as its score
 **Failed list**       | A Redis zset containing job ID as member and the number of times it failed to process as its score



### Running tests
Make sure you have a local Redis running on localhost:6379 (or change these settings in config/default.js). *Warning*: The tests will flush everything in the target Redis DB.

As always, make sure you have run `npm install` to install dependencies first.

Run:

    make test

### TODO
Potential features to come:

* Job payload: Store additional data with a job. ProTip: in the meantime try `var jobID = JSON.stringify(obj);`
* Better docs for and use of failed job logs

#### Inspiration

Convoy was inspired by TJ Holowaychuk's [kue](https://github.com/LearnBoost/kue) module. I was using Kue, but was caught up with some problems when workers did not fully ack the job, causing it to get stuck in the active/inactive lists. Additionally, kue did not seem to offer convenient support for ensuring unique jobs only get queued once, which is the main focus of convoy.
