var Convoy = require('redis-convoy');

var q = Convoy.createQueue("monsterTrucks");

q.process(function(obj, callback){
    // we added in .fn() to the object, but i just wanted to check anywayz
    if (typeof obj.fn == 'function') {
        obj.fn();
    }
    callback();
});

// Lets try and close it all nicely if we die
process.on("SIGINT", function(){
    q.stopProcessing();
    q.close();  
});