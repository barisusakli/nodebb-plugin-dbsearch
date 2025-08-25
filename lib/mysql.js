'use strict';

const winston = require.main.require('winston');
const nconf = require.main.require('nconf');

const db = require.main.require('./src/database');
const pubsub = require.main.require('./src/pubsub');

let searchLanguage = 'english';

pubsub.on('dbsearch-language-changed', (e) => {
    searchLanguage = e.data;
});

async function initDB() {
    const connection = await db.pool.getConnection();
    try {
        // Create tables
        await connection.query(`
            CREATE TABLE IF NOT EXISTS searchtopic (
                id VARCHAR(255) NOT NULL PRIMARY KEY,
                content TEXT,
                uid VARCHAR(255),
                cid BIGINT
            )
        `);

        // Check and create indexes for searchtopic
        const [topicIndexes] = await connection.query(
            'SHOW INDEXES FROM searchtopic WHERE Key_name = "idx__searchtopic__content"'
        );
        if (!topicIndexes.length) {
            await connection.query('CREATE FULLTEXT INDEX idx__searchtopic__content ON searchtopic(content)');
        }

        const [topicUidIndexes] = await connection.query(
            'SHOW INDEXES FROM searchtopic WHERE Key_name = "idx__searchtopic__uid"'
        );
        if (!topicUidIndexes.length) {
            await connection.query('CREATE INDEX idx__searchtopic__uid ON searchtopic(uid)');
        }

        const [topicCidIndexes] = await connection.query(
            'SHOW INDEXES FROM searchtopic WHERE Key_name = "idx__searchtopic__cid"'
        );
        if (!topicCidIndexes.length) {
            await connection.query('CREATE INDEX idx__searchtopic__cid ON searchtopic(cid)');
        }

        // Create searchpost table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS searchpost (
                id VARCHAR(255) NOT NULL PRIMARY KEY,
                content TEXT,
                uid VARCHAR(255),
                cid BIGINT
            )
        `);

        // Check and create indexes for searchpost
        const [postIndexes] = await connection.query(
            'SHOW INDEXES FROM searchpost WHERE Key_name = "idx__searchpost__content"'
        );
        if (!postIndexes.length) {
            await connection.query('CREATE FULLTEXT INDEX idx__searchpost__content ON searchpost(content)');
        }

        const [postUidIndexes] = await connection.query(
            'SHOW INDEXES FROM searchpost WHERE Key_name = "idx__searchpost__uid"'
        );
        if (!postUidIndexes.length) {
            await connection.query('CREATE INDEX idx__searchpost__uid ON searchpost(uid)');
        }

        const [postCidIndexes] = await connection.query(
            'SHOW INDEXES FROM searchpost WHERE Key_name = "idx__searchpost__cid"'
        );
        if (!postCidIndexes.length) {
            await connection.query('CREATE INDEX idx__searchpost__cid ON searchpost(cid)');
        }

        // Create searchchat table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS searchchat (
                id VARCHAR(255) NOT NULL PRIMARY KEY,
                content TEXT,
                rid BIGINT,
                uid VARCHAR(255)
            )
        `);

        // Check and create indexes for searchchat
        const [chatIndexes] = await connection.query(
            'SHOW INDEXES FROM searchchat WHERE Key_name = "idx__searchchat__content"'
        );
        if (!chatIndexes.length) {
            await connection.query('CREATE FULLTEXT INDEX idx__searchchat__content ON searchchat(content)');
        }

        const [chatRidIndexes] = await connection.query(
            'SHOW INDEXES FROM searchchat WHERE Key_name = "idx__searchchat__rid"'
        );
        if (!chatRidIndexes.length) {
            await connection.query('CREATE INDEX idx__searchchat__rid ON searchchat(rid)');
        }

        const [chatUidIndexes] = await connection.query(
            'SHOW INDEXES FROM searchchat WHERE Key_name = "idx__searchchat__uid"'
        );
        if (!chatUidIndexes.length) {
            await connection.query('CREATE INDEX idx__searchchat__uid ON searchchat(uid)');
        }
    } catch (err) {
        const errorParts = ['Error initializing DB'];

        function indent(value) {
            return String(value).split('\n').map(line => `\t${line}`).join('\n');
        }

        Object.keys(err).concat('stack').forEach((key) => {
            errorParts.push(indent(`${key} =`), indent(indent(err[key])));
        });

        winston.error(errorParts.join('\n'));
        throw err;
    } finally {
        connection.release();
    }
}

async function handleError(err) {
    if (err && err.code === 'ER_NO_SUCH_TABLE') {
        winston.warn('dbsearch was not initialized');
        await initDB();
        return;
    }
    throw err;
}

exports.createIndices = async function (language) {
    searchLanguage = language;
    if (nconf.get('isPrimary') && !nconf.get('jobsDisabled')) {
        await initDB();
    }
};

exports.changeIndexLanguage = async function (language) {
    searchLanguage = language;
    pubsub.publish('dbsearch-language-changed', language);
    // MySQL doesn't need to recreate FULLTEXT indexes for language changes
};

exports.searchIndex = async function (key, data, ids) {
    if (!ids.length) return;

    const connection = await db.pool.getConnection();
    try {
        ids = ids.map(String);
        const values = data.map((d, i) => [
            ids[i],
            d.content,
            d.uid,
            d.cid
        ]);

        await connection.query(`
            INSERT INTO search${key} (id, content, uid, cid)
            VALUES ?
            ON DUPLICATE KEY UPDATE
                content = COALESCE(VALUES(content), search${key}.content),
                uid = COALESCE(VALUES(uid), search${key}.uid),
                cid = COALESCE(VALUES(cid), search${key}.cid)
        `, [values]);
    } catch (err) {
        winston.error(`Error indexing ${err.stack}`);
        await handleError(err);
        await exports.searchIndex(key, data, ids);
    } finally {
        connection.release();
    }
};

exports.search = async function (key, data, limit) {
    const connection = await db.pool.getConnection();
    try {
        const uid = Array.isArray(data.uid) && data.uid.filter(Boolean).length ? data.uid.filter(Boolean) : null;
        const cid = Array.isArray(data.cid) && data.cid.filter(Boolean).length ? data.cid.filter(Boolean) : null;

        let query = `SELECT id FROM search${key} WHERE 1=1`;
        const params = [];

        if (data.content) {
            query += ` AND MATCH(content) AGAINST(? IN BOOLEAN MODE)`;
            params.push(data.content);
        }
        if (uid) {
            query += ` AND uid IN (?)`;
            params.push(uid);
        }
        if (cid) {
            query += ` AND cid IN (?)`;
            params.push(cid);
        }
        query += ` ORDER BY MATCH(content) AGAINST(? IN BOOLEAN MODE) DESC, id ASC LIMIT ?`;
        params.push(data.content || '', parseInt(limit, 10));

        const [rows] = await connection.query(query, params);
        return rows.map(row => row.id);
    } catch (err) {
        await handleError(err);
        return [];
    } finally {
        connection.release();
    }
};

exports.searchRemove = async function (key, ids) {
    if (!key || !ids.length) return;

    const connection = await db.pool.getConnection();
    try {
        ids = ids.map(String);
        await connection.query(`DELETE FROM search${key} WHERE id IN (?)`, [ids]);
    } catch (err) {
        await handleError(err);
    } finally {
        connection.release();
    }
};

exports.chat = {};
exports.chat.index = async (data, ids) => {
    if (!ids.length) return;

    const connection = await db.pool.getConnection();
    try {
        ids = ids.map(String);
        const values = data.map((d, i) => [
            ids[i],
            d.content,
            d.rid,
            d.uid
        ]);

        await connection.query(`
            INSERT INTO searchchat (id, content, rid, uid)
            VALUES ?
            ON DUPLICATE KEY UPDATE
                content = COALESCE(VALUES(content), searchchat.content),
                rid = COALESCE(VALUES(rid), searchchat.rid),
                uid = COALESCE(VALUES(uid), searchchat.uid)
        `, [values]);
    } catch (err) {
        winston.error(`Error indexing ${err.stack}`);
        await handleError(err);
        await exports.chat.index(data, ids);
    } finally {
        connection.release();
    }
};

exports.chat.search = async (data, limit) => {
    const connection = await db.pool.getConnection();
    try {
        const uid = Array.isArray(data.uid) && data.uid.filter(Boolean).length ? data.uid.filter(Boolean) : null;
        const roomId = Array.isArray(data.roomId) && data.roomId.filter(Boolean).length ? data.roomId.filter(Boolean) : null;

        let query = `SELECT id FROM searchchat WHERE 1=1`;
        const params = [];

        if (data.content) {
            query += ` AND MATCH(content) AGAINST(? IN BOOLEAN MODE)`;
            params.push(data.content);
        }
        if (uid) {
            query += ` AND uid IN (?)`;
            params.push(uid);
        }
        if (roomId) {
            query += ` AND rid IN (?)`;
            params.push(roomId);
        }
        query += ` ORDER BY MATCH(content) AGAINST(? IN BOOLEAN MODE) DESC, id ASC LIMIT ?`;
        params.push(data.content || '', parseInt(limit, 10));

        const [rows] = await connection.query(query, params);
        return rows.map(row => row.id);
    } catch (err) {
        await handleError(err);
        return [];
    } finally {
        connection.release();
    }
};