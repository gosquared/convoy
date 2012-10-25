var debug = require('debug')('convoy:config');

try{
  var config = require('config');
  debug('Loading config from node-config');
  module.exports = config.setModuleDefaults('convoy', process.env.NODE_ENV == 'test' ? config : require('./config/default'));
}
catch(e){
  debug('Setting config to production defaults');
  module.exports = require('./config/default');
}