var config = require('../config');
var keyPrefix = config.keys.prefix;

exports.key = function(name){
  return keyPrefix + name;
};

exports.time = function(){
  return ~~(new Date()/1000);
};
