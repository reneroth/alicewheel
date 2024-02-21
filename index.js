const Gpio = require('onoff').Gpio
const irSensor = new Gpio(23, 'in', 'both', { debounceTimeout: 20 })
const feeder = new Gpio(24, 'high')
feeder.writeSync(Gpio.HIGH)
const player = require('play-sound')()

const FEEDER_TURNING_DURATION = 11000
const WHEEL_SEGMENTS = 24

const COUNTER_TARGET = 5 // 7
const STEPS_PER_COUNT = WHEEL_SEGMENTS * 0.75
const STEPS_PER_COUNT_INCREASE = 1.05 // 1.1
const JACKPOT_BASE_CHANCE = 100
const JACKPOT_CHANCE_DECREASE_PER_WIN = 0 // 20
const JACKPOT_TTL = 1000 * 60 * 60 * 5
const JACKPOT_COOLDOWN = 1000 * 20

const IDLE_TIME = 1000 * 10

let currentCount = 0
let currentStepsTowardsCount = 0
let stepCounterResetTimeout = null
let lastJackpotWins = []
let isOnJackpotCooldown = false

let lastMovementTimestamps = []

let isFeeding = false

let clearRpmInterval = null
let lastRpmOutputTimestamp = Date.now()
let lastRpm = 0

irSensor.watch((err, value) => {
  if (err) {
    return
  }
  if (!value) {
    trackRotation()
  }
})

const trackRotation = () => {
  const now = Date.now()
  lastMovementTimestamps.push(now)
  if (lastMovementTimestamps.length > WHEEL_SEGMENTS) {
    lastMovementTimestamps.shift()
  }

  displayRpm()
  addStep()
}

const displayRpm = () => {
  if (
    Date.now() - lastRpmOutputTimestamp < 1000
    || lastMovementTimestamps.length < WHEEL_SEGMENTS) {
    return
  }
  lastRpmOutputTimestamp = Date.now()
  clearTimeout(clearRpmInterval)
  clearRpmInterval = setTimeout(() => {
    lastMovementTimestamps = []
    lastRpm = 0
    console.log(`RPM: ${lastRpm}`)
  }, IDLE_TIME)

  const averageDuration = lastMovementTimestamps.reduce((acc, cur, i, arr) => {
    if (i === 0) {
      return acc
    }
    return acc + (cur - arr[i - 1])
  }, 0) / lastMovementTimestamps.length
  const rpm = Math.round(60000 / (averageDuration * WHEEL_SEGMENTS))
  if (lastRpm === rpm) {
    return
  }
  lastRpm = rpm
  console.log(`RPM: ${rpm}`)
}

const addStep = () => {
  const now = new Date()
  const winLimitReached = JACKPOT_CHANCE_DECREASE_PER_WIN && lastJackpotWins.filter(timestamp => timestamp > Date.now() - JACKPOT_TTL).length >= (100 / JACKPOT_CHANCE_DECREASE_PER_WIN)
  if (
    isFeeding
    || isOnJackpotCooldown
    || winLimitReached
    || now.getHours() >= 21
    || now.getHours() < 7
    ) {
    return
  }

  // each count needs more steps to be reached than the previous one
  // to give the cats an incentive to keep playing.
  // if the cats stop playing, the counter will reset.
  // running faster will add steps faster, but with diminishing returns.
  // the counter will reset if the cats stop playing for 5 seconds.
  clearTimeout(stepCounterResetTimeout)
  stepCounterResetTimeout = setTimeout(resetStepCounter, IDLE_TIME)

  const currentlyNeededSteps = Math.round(STEPS_PER_COUNT * Math.pow(STEPS_PER_COUNT_INCREASE, currentCount)) * 10
  currentStepsTowardsCount += 10 * (1 - Math.min(0.0, lastRpm / 100)) // TODO: better way to calculate diminishing returns
  if (currentStepsTowardsCount >= currentlyNeededSteps) {
    nextCountReached()
  }
}

const nextCountReached = () => {
  currentCount += 1
  if (currentCount >= COUNTER_TARGET) {
    runJackpot()
    return
  }
  currentStepsTowardsCount = 0
  player.play(`./sounds/count-${currentCount}.wav`)
}

const resetStepCounter = () => {
  // only play abort sound if we reached at least the first count
  if (currentCount) {
    player.play('./sounds/abort.wav')
    console.log(`Aborted at count ${currentCount} with ${currentStepsTowardsCount/10} steps.`)
  }
  currentStepsTowardsCount = 0
  currentCount = 0
}

const runJackpot = () => {
  clearTimeout(stepCounterResetTimeout)
  // base chance is at 100%, decreasing by a set amount for each jackpot win in the last 5 hours
  // lastJackpotWins is an array of timestamps
  const now = Date.now()
  let relevantJackpotWins = lastJackpotWins.filter(timestamp => timestamp > now - JACKPOT_TTL)
  const chance = Math.max(0, JACKPOT_BASE_CHANCE - (relevantJackpotWins.length * JACKPOT_CHANCE_DECREASE_PER_WIN))

  isOnJackpotCooldown = true
  setTimeout(() => {
    isOnJackpotCooldown = false
  }, JACKPOT_COOLDOWN)

  const luckyNumber = Math.floor(Math.random() * 100)
  console.log(`Jackpot chance: ${chance}%, lucky number: ${luckyNumber}`)
  if (luckyNumber > chance) {
    loseJackpot()
    return
  }

  winJackpot()
}

const loseJackpot = () => {
  currentCount = 0
  currentStepsTowardsCount = 0
  player.play('./sounds/lose.wav')
}

const winJackpot = () => {
  lastJackpotWins.push(Date.now())
  if (lastJackpotWins.length > 10) {
    lastJackpotWins.shift()
  }

  currentCount = 0
  currentStepsTowardsCount = 0
  player.play('./sounds/win.wav')
  runFeeder()
}

const runFeeder = () => {
  isFeeding = true
  feeder.writeSync(Gpio.LOW)
  setTimeout(() => {
    feeder.writeSync(Gpio.HIGH)
  }, 100)
  setTimeout(() => {
    isFeeding = false
  }, FEEDER_TURNING_DURATION)
}

process.on('SIGINT', () => {
  irSensor.unexport()
  feeder.unexport()
})