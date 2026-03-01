function startRuntimeLoops({ taskUC, ossUC, subscriptionUC, bootstrapUC, store, captureLoopError }) {
  const taskTicker = setInterval(() => {
    taskUC.tick().catch((error) => captureLoopError(store, 'task.tick', error));
  }, 1000);
  const compensationTicker = setInterval(() => {
    if (typeof taskUC.isRecoveryChainEnabled === 'function' && !taskUC.isRecoveryChainEnabled()) return;
    taskUC.processCompensations().catch((error) => captureLoopError(store, 'compensation.tick', error));
  }, 1500);
  const researchTicker = setInterval(() => {
    ossUC.processQueuedResearch(1).catch((error) => captureLoopError(store, 'research.tick', error));
  }, 2500);
  const subscriptionTicker = setInterval(() => {
    if (!subscriptionUC || typeof subscriptionUC.runDueSubscriptions !== 'function') return;
    subscriptionUC.runDueSubscriptions({ actorUserId: 'system' })
      .catch((error) => captureLoopError(store, 'subscription.tick', error));
  }, 60 * 1000);
  const bootstrapTicker = setInterval(() => {
    try {
      bootstrapUC.runCycle();
    } catch (error) {
      captureLoopError(store, 'bootstrap.tick', error);
    }
  }, 5000);

  return () => {
    clearInterval(taskTicker);
    clearInterval(compensationTicker);
    clearInterval(researchTicker);
    clearInterval(subscriptionTicker);
    clearInterval(bootstrapTicker);
  };
}

module.exports = {
  startRuntimeLoops
};
