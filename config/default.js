module.exports = {
	redis: {
		host: 'localhost',
		port: 6379,
    database: 15
	},

	keys: {
		prefix: 'cv:',
    logTTL: 86400,

		queued: 'queued',
		processing: 'processing',
		failed: 'failed'
	}
};