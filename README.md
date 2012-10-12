## Convoy

Convoy is a Node.JS module for working with a Redis-backed job queue.

It is designed to be distributed and atomic, orchestrating the queuing, delegation and processing of jobs with unique IDs. 

This means that you can have multiple job publishers and multiple consumers for the same queues, even across many servers, and convoy will ensure that unique jobs only get queued once at a time, and delegated to a single worker until queued again.

### Installation
    npm install redis-convoy

### Usage

````
var Convoy = require('redis-convoy');

// Create a queue object
var q = Convoy.createQueue('monsterTrucks');

// Set up our job. Each job must have an ID
var jobID = 1;
var job = new Convoy.Job(jobID);

// Queue the job once only. If another instance of convoy tries to add a job of the same ID at the same time before any workers process it, it won't get duplicated in the queue

q.addJob(job);

// Set up a worker
q.process(function(job, done){
	console.log(job);
	done(); // or done('an error') if error during processing of the job
});

````

### Running tests
Make sure you have a local redis running on localhost:6379 (or change these settings in config/default.js), then run:

    make test


#### Inspiration

Convoy was inspired by TJ Holowaychuk's [kue](https://github.com/LearnBoost/kue) module. I was using Kue, but was caught up with some problems when workers did not fully ack the job, causing it to get stuck in the active/inactive lists. Additionally, kue did not seem to offer convenient support for ensuring unique jobs only get queued once, which is the main focus of convoy.