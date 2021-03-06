module.exports = (ctx, options)->
  [options, ctx] = [ctx, options]  unless options
  options       ?= {}
  ctx           ?= this
  
  totalReconnectAttempts  = 0
  initalDelayMs           = options.initialDelayMs ? 700
  multiplyFactor          = options.multiplyFactor ? 1.4
  maxDelayMs              = options.maxDelayMs ? 1000 * 15 # 15 seconds
  maxReconnectAttempts    = options.maxReconnectAttempts ? 50

  ctx.clearBackoffTimeout = ->
    totalReconnectAttempts = 0

  ctx.setBackoffTimeout = (attemptFn, failFn)=>
    if totalReconnectAttempts < maxReconnectAttempts
      timeout = Math.min initalDelayMs * Math.pow(
        multiplyFactor, totalReconnectAttempts
      ), maxDelayMs
      setTimeout attemptFn, timeout
      totalReconnectAttempts++
    else
      failFn()

  return ctx
