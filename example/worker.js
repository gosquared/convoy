var Convoy = require('redis-convoy');

var q = Convoy.createQueue("monsterTrucks");

var jobID = 1;
var job = new Convoy.Job(jobID, function(){
        console.log("[this is the job we'd execute on the server...]");        
    });
q.addJob(job);
