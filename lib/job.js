
var Job = function(id){
	if(!id) throw new Error('Jobs must have an ID');
	this.id = id;
};

module.exports = Job;
