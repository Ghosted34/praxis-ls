/**
 * BullMQ producer helper. Lets any process (the API, a cron) enqueue jobs
 * onto a queue without owning the consumer Worker. Queues are lazily created
 * and cached, sharing the app's Redis connection.
 */

"use strict";

const { Queue } = require("bullmq");
const { getClient } = require("../config/redis");

const producers = new Map();

function getProducer(name) {
  if (!producers.has(name)) {
    producers.set(name, new Queue(name, { connection: getClient() }));
  }
  return producers.get(name);
}

async function enqueue(name, jobName, data, opts = {}) {
  return getProducer(name).add(jobName, data, {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    ...opts,
  });
}

module.exports = { getProducer, enqueue };
