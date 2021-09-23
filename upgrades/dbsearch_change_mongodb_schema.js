'use strict';


const winston = require.main.require('winston');
const db = module.parent.require('./database');

module.exports = {
	name: 'Changing dbsearch mongodb search schema to use _id',
	timestamp: Date.UTC(2018, 10, 26),
	method: async function () {
		const nconf = require.main.require('nconf');
		const isMongo = nconf.get('database') === 'mongo';
		if (!isMongo) {
			return;
		}

		const plugin = require('../lib/dbsearch');
		await db.client.collection('searchtopic').deleteMany({});
		await db.client.collection('searchpost').deleteMany({});
		try {
			await db.client.collection('searchtopic').dropIndex({ id: 1 });
			await db.client.collection('searchpost').dropIndex({ id: 1 });
		} catch (err) {
			winston.error(err.stack);
		}
		await plugin.reindex();
	},
};