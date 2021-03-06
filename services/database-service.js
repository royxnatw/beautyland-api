
/**
 * Project Beautyland
 * Database service: Handle database relative actions
 * @author Roy Lu
 */

const MongoClient = require('mongodb').MongoClient;

const config = require('../config/main-config');
const connectionOptions = {
  connectTimeoutMS: 50000,
  keepAlive: 300000,
  reconnectInterval: 2000,
  reconnectTries: Number.MAX_VALUE,
};

const log = require('services/log-service').init('db');

class DatabaseService {
  constructor(url) {
    this.dbUrl = url;
    this.conn = null;
    this.name = null;
    this.postsCollection = null;
    this.instanceId = Date.now();
  }

  async connect(name) {
    if(!this.conn) {
      try {
        log.info(`DB.connect() started. name:${name}, url:${this.dbUrl}`);
        this.name = name;
        this.conn = await MongoClient.connect(this.dbUrl, connectionOptions);
        if (config.env === 'production') {
          this.postsCollection = this.conn.collection('posts');
        } else {
          this.postsCollection = this.conn.collection('posts-test');
        }
        log.info('DatabaseService.connect() finished.');
      } catch(ex) {
        log.error({ex: ex.stack}, 'Error in database-service.connect()');
      }
    }
  }

  close(force = false) {
    this.conn.close();
  }

  info() {
    return {
      isConnected: (this.conn)? true: false,
      dbUrl: this.dbUrl,
      name: this.name,
    };
  }

  /**
   * Check if the post does exist in the database by postId.
   * @param {String} postId   The post id
   * @return {Promise<boolean>} Resolve true if the post exists.
   */
  checkPostExists(postId) {
    return new Promise( (resolve, reject) => {
      if(!this.conn) {
        return reject('Database connection does not exist.');
      }

      this.postsCollection.findOne({postId: postId}, function(err, doc) {
        if (err) {
          return reject(err);
        }
        if (doc) {	// found a post
          return resolve(true);
        } else {		// doesn't find a post
          return resolve(false);
        }
      });
    });
  }

  isConnected() {
    return (this.conn)? true: false;
  }

  async savePost(preparedPost) {
    try {
      if (!this.conn) {
        throw new Error('Database connection does not exist.');
      }

      const isExists = await this.postsCollection.findOne({postId: preparedPost.postId});
      if (isExists) {
        return false;     // The post already exists
      }

      const result = await this.postsCollection.insertOne(preparedPost);
      if (result && result.result.n === 1) {
        log.info(`Post:${preparedPost.postId} saved.`);
        //return resolve({ok: 1});
        return true;
      } else {
        throw new Error({
          result,
          message: 'Error after insertOne in db.savePost()'
        });
      }
    } catch(ex) {
      log.error({
        ex, args: arguments, stack: ex.stack
      }, 'Error in db-service.updatePostViewCount()');
    }
  }

  /**
   * Read post from database.
   * @param {string} postId The post id
   * @return {post|null} The found post, or null if there is no result for the given postId.
   */
  readPost(postId, {isAdmin = false} = {}) {
    return new Promise( (resolve, reject) => {
      if(!this.conn) {
        return reject('Database connection does not exist.');
      }

      const query = {postId};
      const projection = {'_id': 0};

      if(!isAdmin) {
        query.visibility = true;
        projection.visibility = 0;
      }

      this.postsCollection.findOne(query, projection, (err, doc) => {
        if (err) {
          return reject(err);
        }
        if (doc) {  // found a post
          return resolve(doc);
        } else {		// no any post, resolve null
          return resolve(null);
        }
      });
    });
  }


  /**
   * Read posts from database
   * @return {posts|null} The found posts, or null if there is no any result
   */
  readPosts({query = {}, order = {createdAt: -1}, size = 10, skip = 0} = {}) {		
    return new Promise( (resolve, reject) => {
      if (!this.conn) {
        return reject('Database connection does not exist.');
      }

      console.log(`query`, query);
      this.postsCollection.find(query)
      .sort(order).skip(skip).limit(size).project({_id: 0, visibility: 0})
      .toArray((err, docs) => {
        if(err) {
          return reject(err);
        }
        console.log(`readPosts=`, {docs});
        if (docs.length > 0) {
          return resolve(docs);
        } else {    // no any result, resolve null
          return resolve(null);
        }
      });
    });
  }

  readRandomPosts({size = 20} = {}) {
    return new Promise( async (resolve, reject) => {
      if (!this.conn) {
        return reject('Database connection does not exist.');
      }

      try {
        const docs = await this.postsCollection.aggregate([
          { $match: {visibility: true} }, 
          { $sample: {size} }          
        ]).toArray();
        return resolve(docs);
      } catch(ex) {
        return reject(ex);
      }
    });
  }


  deletePost(postId) {
    return new Promise( (resolve, reject) => {
      if(!this.conn) {
        return reject('Db does not exist.');
      }
      this.postsCollection.deleteOne({postId: postId}, function(err, result) {
        if(err) {
          return reject(err);
        }
        if(result.result.ok === 1 && result.result.n === 1) {
          //return resolve({ok: 1, n: result.result.n});
          return resolve(true);
        } else {    // the post does not exist. Delete nothing
          return resolve(false);
          //return reject('Something wrong in database-service.deletePost(): result=', result);
        }
      });
    });
  }

  async updatePostVisibility(postId, visibility) {
    try{
      const result = await this.postsCollection.findOneAndUpdate(
        {postId}, {$set: {visibility} }, {returnOriginal: false}
      );
      log.info(`result=`, result);
      if(result.ok && result.value) {
        return true;
      } else {
        return false;
      }
    }catch(ex) {
      log.error({visibility, ex: ex.stack}, 'Error in db-service.updatePostVisibility()');
      return false;
    }
  }

  async updatePostViewCount(postId) {
    try {
      const r = await this.postsCollection.findOneAndUpdate(
        {postId},  {$inc: {viewCount: 1}}, {returnOriginal: false}
      );

      if (r.ok && r.value) {
        return true;
      } else {
        return false;
      }
    } catch(ex) {
      log.error({postId, ex: ex.stack}, 'Error in db-service.updatePostViewCount()');
      return false;
    }
  }
}

let instance = null;

const init = (url) => {
  instance = new DatabaseService(url);
  return instance;
};

module.exports.init = init;



// var instance = null;

// module.exports = async function(url) {
// 	try{
// 		if(!instance || !instance.isConnected) {
// 			log.debug(`Now trying to instance a database.`);
// 			instance = new DatabaseService(url);
// 			await instance.connect();
// 			log.debug(`Database instanec created.`);
// 		}
// 		return instance;
// 	}catch(ex) {
// 		log.error({ex: ex.stack}, 'Error in module.exports');
// 		return null;
// 	}
// };

// module.exports.getInstance = function(source) {
//   if(instance) {
//     return instance;
//   } else {
//     throw new Error('Database service instance doesn\'t exist.');
//   }
// }