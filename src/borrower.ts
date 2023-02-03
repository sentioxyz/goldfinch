import {
  PaymentAppliedEvent,
  TrancheLockedEvent,
  getTranchedPoolContract
} from './types/tranchedpool/index.js';
import { InvestmentMadeInSeniorEvent, SeniorPoolContext, SeniorPoolProcessor } from './types/seniorpool/index.js';
import { CreditLineContext, CreditLineProcessor, CreditLineProcessorTemplate, getCreditLineContract } from './types/creditline/index.js'
import { getGoldfinchConfigContract } from './types/goldfinchconfig/index.js';
import { goldfinchPools } from './goldfinchPools.js';
import { TranchedPoolContext, TranchedPoolProcessor } from './types/tranchedpool/index.js';
import { BigDecimal, Gauge } from '@sentio/sdk'
import type { Block } from 'ethers'

import { GF_CONFIG_ADDR, SENIOR_POOL_ADDR, GF_CONFIG_NEW_DEPLOY_BLOCK, GF_CONFIG_ADDR_OLD } from './constant.js'
import { DAYS_PER_YEAR, isPaymentLate, isPaymentLateForGracePeriod, SECONDS_PER_DAY } from './helpers.js';
import { scaleDown } from "@sentio/sdk";

interface PoolItem {
  auto?: boolean;
  name: string;
  poolAddress: string;
  creditLineAddress: string;
  poolStartBlock: number;
  creditLineStartBlock: number;
  status: string;
  version: number;
}

// making sure GFconfig is deployed
const configStartBlock = 13941061
const decimal = 6

const SAMPLE_RATE = 10
const SAMPLE_START = 15000000

const POOL_ADDRESS_LOOKUP = new Map<string, PoolItem>()
const CREDIT_ADDRESS_LOOKUP = new Map<string, PoolItem>()

const paymentAppliedGauge = Gauge.register("payment_applied", {
  sparse : true,
})

const poolFunded3 = Gauge.register("pool_funded3", {
  sparse : true,
})

// @ts-ignore
for (let i = 0; i < goldfinchPools.data.length; i++) {
  // @ts-ignore
  const tranchedPool = goldfinchPools.data[i];
  POOL_ADDRESS_LOOKUP.set(tranchedPool.poolAddress, tranchedPool)
  CREDIT_ADDRESS_LOOKUP.set(tranchedPool.creditLineAddress, tranchedPool)
}

function getPoolByAddress(address: string) {
  //since it is not possible for creditline and pool address to be the same
  // we can simply look up both tables and return any possible match
  if (POOL_ADDRESS_LOOKUP.get(address) !== undefined) {
    return POOL_ADDRESS_LOOKUP.get(address)!
  } else  if (CREDIT_ADDRESS_LOOKUP.get(address) !== undefined) {
    return CREDIT_ADDRESS_LOOKUP.get(address)!
  } else {
    return undefined
  }
}

function getNameByAddress(address: string) {
  const poolItem = getPoolByAddress(address)
  if (poolItem !== undefined) {
    return poolItem.name
  } else {
    return ""
  }
}


//MigratedTranchedPool_evt_PaymentApplied
const PaymentAppliedEventHandler = async function(event: PaymentAppliedEvent, ctx: TranchedPoolContext) {
  const interestAmount = scaleDown(event.args.interestAmount - event.args.reserveAmount, decimal)
  const principalAmount = scaleDown(event.args.principalAmount, decimal)
  const poolName = getNameByAddress(event.address)
  // used in V2 for the following request:
  //   total interest paid
  // Loop through all PaymentApplied events
  //   total principal paid
  // Loop through all PaymentApplied events (and look at the principal paid back)
  ctx.meter.Gauge('interest').record(interestAmount, {"pool": poolName})
  ctx.meter.Counter('interest_acc').add(interestAmount, {"pool": poolName})
  ctx.meter.Gauge('principal_paid').record(principalAmount, {"pool": poolName})
  ctx.meter.Counter('principal_paid_acc').add(principalAmount, {"pool": poolName})
  ctx.meter.Counter("payment_applied_count").add(1, {"pool": poolName})

  //determine if payment is late, used in V2
  const paymentTime = BigInt(ctx.timestamp.getTime()) / 1000n
  const creditLine = await getTranchedPoolContract(event.address).creditLine({blockTag: event.blockNumber - 1})
  // 5 is the index for LatenessGracePeriodInDays see https://github.com/goldfinch-eng/mono/blob/7d8721246dfdc925512f1dd44c653707d62158ff/packages/protocol/contracts/protocol/core/ConfigOptions.sol#L23

  var graceLateness
  if (ctx.blockNumber < configStartBlock) {
    graceLateness = 45n
  } else {
    graceLateness = (await getGoldfinchConfigContract(GF_CONFIG_ADDR).getNumber(5, {blockTag: event.blockNumber - 1}))
  }
  const nextDueTime = (await getCreditLineContract(creditLine).nextDueTime({blockTag: event.blockNumber - 1}))
  const balance = (await getCreditLineContract(creditLine).balance({blockTag: event.blockNumber - 1}))
  const isLate = isPaymentLate(paymentTime, nextDueTime, balance)
  const isLateForGracePeriod = isPaymentLateForGracePeriod(paymentTime, nextDueTime, graceLateness, balance)
  const ts = ctx.timestamp.getTime()
  const humanReadableDate = new Date(ts).toISOString().split('T')[0]

  // const isPaymentLate = await getCreditLineContract(event.address).isLate({blockTag: event.blockNumber - 1})
  // const isPaymentWithinGracePeriod = await getCreditLineContract(event.address).withinPrincipalGracePeriod({blockTag: event.blockNumber - 1})
  // using payment applied value to encode status
  // 1: on-time
  // 2: late
  // 3: late for grace period
  if (isLateForGracePeriod) {
    paymentAppliedGauge.record(ctx, 3, {"pool": poolName, "status": "late for grace", "date": humanReadableDate})
    ctx.meter.Gauge("payment_late_grace").record(1, {"pool": poolName, "date": humanReadableDate})
    ctx.meter.Counter("payment_late_grace_period_count").add(1, {"pool": poolName})
    ctx.meter.Counter("payment_late_count").add(0, {"pool": poolName})
  } else if (isLate) {
    paymentAppliedGauge.record(ctx, 2, {"pool": poolName, "status": "late", "date": humanReadableDate})
    ctx.meter.Gauge("payment_late").record(1, {"pool": poolName, "date": humanReadableDate})
    ctx.meter.Counter("payment_late_grace_period_count").add(0, {"pool": poolName})
    ctx.meter.Counter("payment_late_count").add(1, {"pool": poolName})
  } else {
    paymentAppliedGauge.record(ctx, 1, {"pool": poolName, "status": "on-time", "date": humanReadableDate})
    ctx.meter.Counter("payment_late_grace_period_count").add(0, {"pool": poolName})
    ctx.meter.Counter("payment_late_count").add(0, {"pool": poolName})
  }

}

async function InvestmentMadeInSenior (event: InvestmentMadeInSeniorEvent, ctx: SeniorPoolContext) {
  const poolAddress = event.args.tranchedPool.toLowerCase()
  const poolName = getNameByAddress(poolAddress)
  const poolInfo = getPoolByAddress(poolAddress)
  const ts = BigInt(ctx.timestamp.getTime()) / 1000n

  ctx.meter.Counter("pool_funded2").add(ts, {"pool": poolName, "addr": poolAddress})
  poolFunded3.record(ctx, ts, {"pool": poolName, "addr": poolAddress})

  var gfConfigAddress
  if (event.blockNumber > GF_CONFIG_NEW_DEPLOY_BLOCK) {
    gfConfigAddress = GF_CONFIG_ADDR
  } else {
    gfConfigAddress = GF_CONFIG_ADDR_OLD
  }

  const leverageRatio =scaleDown(await getGoldfinchConfigContract(gfConfigAddress).getNumber(9, {blockTag: event.blockNumber}), 18)

  ctx.meter.Counter('leverage_ratio2').add(leverageRatio, {pool: poolName})
}

async function creditlineHandler (block: Block, ctx: CreditLineContext) {
  const poolName = getNameByAddress(ctx.address)
  const pool = getPoolByAddress(ctx.address)
  const ts = new BigDecimal(block.timestamp)

  // console.log("start" +  ctx.contract._underlineContract.address)
  const loanBalance = scaleDown(await ctx.contract.balance(), 6)
  ctx.meter.Gauge('tranchedPool_balance').record(loanBalance, {"pool": poolName})

  // if (!shouldSample(block.number)) {
  //   return
  // }
  // added in V2 for
  //   next payment due
  //   CreditLine.nextDueTime

  const nextDueTime = (await ctx.contract.nextDueTime()).asBigDecimal()
  ctx.meter.Gauge('tranchedPool_nextdue').record(nextDueTime, {"pool": poolName})

   // V2 request:
  //   Full repayment schedule by month (ie. Expected amount of cash to be paid back in Jan, Feb, March, April, etc. for every month from now until loan maturity)
  // Requires manual calculation, but involves using creditLine.paymentPeriodInDays (eg. if 30, then payments are made every 30 days) and creditLine.nextDueTime (tells you exact time of next expected payment).

  const interestApr = scaleDown(await ctx.contract.interestApr(), 18)
  const termEnd = (await ctx.contract.termEndTime()).asBigDecimal()
  const paymentPeriod = (await ctx.contract.paymentPeriodInDays()).asBigDecimal()
  var graceLateness
  if (ctx.blockNumber < configStartBlock) {
    graceLateness = new BigDecimal(45)
  } else {
    graceLateness = (await getGoldfinchConfigContract(GF_CONFIG_ADDR).getNumber(5, {blockTag: block.number})).asBigDecimal()
  }
  if (!paymentPeriod.eq(0) && !termEnd.eq(0) && !nextDueTime.eq(0)) {
    const numOfTerms = termEnd.minus(nextDueTime).div(paymentPeriod.multipliedBy(SECONDS_PER_DAY.asBigDecimal())).integerValue(BigDecimal.ROUND_CEIL)
    const termInterest = interestApr.multipliedBy(paymentPeriod).div(DAYS_PER_YEAR)
    const termPayment = loanBalance.multipliedBy(termInterest)

    ctx.meter.Gauge('tranchedPool_next_payment').record(termPayment, {"pool": poolName})
    var paymentDate = nextDueTime
    while (paymentDate.lte(termEnd)) {
      const unixTime = paymentDate.toNumber()
      const humanReadableDate = new Date(unixTime * 1000).toISOString().split('T')[0]
      ctx.meter.Gauge('tranchedPool_payment_schedule').record(termPayment, {'date': humanReadableDate, 'pool': poolName})
      paymentDate = paymentDate.plus(paymentPeriod.multipliedBy(SECONDS_PER_DAY.asBigDecimal()))
    }

  // 1: on-time
  // 2: late
  // 3: late for grace period
    if (ts.gt(nextDueTime.plus(graceLateness.multipliedBy(SECONDS_PER_DAY.asBigDecimal())))) {
      ctx.meter.Gauge('is_late').record(3, {"pool": poolName})
    } else if (ts.gt(nextDueTime)) {
      ctx.meter.Gauge('is_late').record(2, {"pool": poolName})
    } else {
      ctx.meter.Gauge('is_late').record(1, {"pool": poolName})
    }
  } else {
    ctx.meter.Gauge('tranchedPool_next_payment').record(0, {"pool": poolName})
  }


}
async function tranchedPoolHandler(block: Block, ctx: TranchedPoolContext) {
  const poolName = getNameByAddress(ctx.address)
  var pool = getPoolByAddress(ctx.address)

  var leverageRatio
  if (ctx.blockNumber < configStartBlock) {
    leverageRatio = 3
  } else {
    leverageRatio = scaleDown(await getGoldfinchConfigContract(GF_CONFIG_ADDR).getNumber(9, {blockTag: block.number}),18)
  }
  ctx.meter.Gauge('leverage_ratio').record(leverageRatio)

if (pool == undefined) {
    return
  }
  pool = pool!
  if (pool.version > 0)
  {
    const creditLine = await ctx.contract.creditLine()
    const juniorBalance = (await ctx.contract.getTranche(2))[1]
    const seniorBalance = (await ctx.contract.getTranche(1))[1]
    const totalDeployed = juniorBalance + seniorBalance
    ctx.meter.Gauge('senior_tranche_balance').record(scaleDown(seniorBalance, 6), {"pool": poolName})
    ctx.meter.Gauge('junior_tranche_balance').record(scaleDown(juniorBalance, 6), {"pool": poolName})
    if (totalDeployed !== 0n) {
      const seniorPortion = seniorBalance.asBigDecimal().div(totalDeployed.asBigDecimal())

      const interestApr = scaleDown(await getCreditLineContract(creditLine).interestApr(), 18)

      ctx.meter.Gauge('senior_apr').record(interestApr.multipliedBy(0.7), {"pool": poolName})
      // junior apr = apr * (1 - senior_portion + 0.2 * senior_portion) / ( 1 - senior_portion )= apr * (1 - 0.8 * senior_portion) / (1 - senior_portion)
      const juniorApr = interestApr.multipliedBy((new BigDecimal(1)).minus(seniorPortion.multipliedBy(0.8))).div((new BigDecimal(1)).minus(seniorPortion))
      ctx.meter.Gauge('junior_apr').record(juniorApr, {"pool": poolName})
    } else {
      ctx.meter.Gauge('senior_apr').record(0, {"pool": poolName})
      ctx.meter.Gauge('junior_apr').record(0, {"pool": poolName})
    }
  }
 }


// additional events for V2 request
const trancheLockedEventHandler = async function(event:TrancheLockedEvent, ctx: TranchedPoolContext) {
  const trancheId = event.args.trancheId
  const poolName = getNameByAddress(event.address)
  if (trancheId === 1n) {
    // for V2 request:
    //     next payment due
    // CreditLine.nextDueTime
    const ts = BigInt(ctx.timestamp.getTime()) / 1000n
    // TODO: temp workaround, use counter so we can preserve the value for bar gauge
    ctx.meter.Counter("pool_funded").add(ts, {"pool": poolName})
  }
}

for (let i = 0; i < 12; i++) {
  // @ts-ignore
  const tranchedPool = goldfinchPools.data[i];
  CreditLineProcessor.bind({address: tranchedPool.creditLineAddress, startBlock: tranchedPool.creditLineStartBlock})
      .onBlockInterval(creditlineHandler)

  TranchedPoolProcessor.bind({address: tranchedPool.poolAddress, startBlock: tranchedPool.poolStartBlock})
  .onBlockInterval(tranchedPoolHandler)
  .onEventPaymentApplied(PaymentAppliedEventHandler)
  .onEventTrancheLocked(trancheLockedEventHandler)
}

SeniorPoolProcessor.bind({address: SENIOR_POOL_ADDR})
.onEventInvestmentMadeInSenior(InvestmentMadeInSenior)
