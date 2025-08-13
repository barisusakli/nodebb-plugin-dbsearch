'use strict';


const db = module.parent.require('./database');

module.exports = {
	name: 'Changing integer cid index to text for psql',
	timestamp: Date.UTC(2025, 6, 8),
	method: async function () {
		const nconf = require.main.require('nconf');
		const mainDB = nconf.get('database');
		if (mainDB !== 'postgres') {
			return;
		}

		try {
			await db.client.query('ALTER TABLE searchtopic ALTER COLUMN cid TYPE text USING cid::bigint');
			await db.client.query('ALTER TABLE searchpost ALTER COLUMN cid TYPE text USING cid::bigint');
		} catch (err) {
			console.error(err.stack);
		}
	},
};
