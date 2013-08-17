
var Job = function(id){
	if(typeof id == 'undefined') throw new Error('Jobs must have an ID');
	this.id = id;
};

module.exports = Job;
