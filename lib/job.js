
var Job = function(id, fn, callback){
	if(!id){
		throw new Error('Jobs must have an ID');
	}
	if (typeof fn != 'undefined' && typeof fn != 'function') {
    	throw new Error('Jobs second parameter must be a function (if provided).');
	}
	if (!fn) {
    	var fn = function(){ console.log('default method.'); };
	}
	if (!callback) {
    	var callback = function(){};
	}
	this.fn = fn;
	this.func = false;
	this.id = id;
	callback();
};

/**
 * .Encode is provided so we can store methods in Redis assoc. with the Job Object
 */
Job.prototype.Encode = function(){
    this.func = this.fn.toString();
}

/**
 * .Decode is provided to get the method back to normal
 * I hate eval() too but wasn't able to see another way to take string back to method
 */
Job.prototype.Decode = function() {
    if (typeof this.func != 'string') {
        return false;
    }
    this.fn = eval("(" + this.func + ")")
}

/**
 * .SetRawMethod - Used by Queue to set the object up after it's been pulled out of the Redis Object
 */
Job.prototype.setRawMethod = function(func) {
    this.func = func;
    this.Decode();
}

Job.prototype.setMethod = function(fn) {
    this.fn = fn;
}

module.exports = Job;