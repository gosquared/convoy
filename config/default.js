module.exports = {
	redis: {
		host: 'localhost',
		port: 6379,
    database: 15
	},

	keys: {
		prefix: 'cv:',
		queued: 'queued',
		processing: 'processing',
		failed: 'failed'
	}
};