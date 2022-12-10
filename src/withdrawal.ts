import { FIDU, FIDU_DECIMAL, SENIOR_POOL_V2, USDC_DECIMAL, WRT_ADDR, SENIOR_POOL_V2_START, ZAPPER } from "./constant";
import type { Block } from '@ethersproject/providers'
import { scaleDown } from '@sentio/sdk/lib/utils/token'
import { EpochEndedEvent, SeniorPoolV2Context, SeniorPoolV2Processor, WithdrawalCanceledEvent, WithdrawalMadeEvent } from "./types/seniorpoolv2";
import { WithdrawalRequestTokenContext, WithdrawalRequestTokenProcessor } from "./types/withdrawalrequesttoken";
import { getSeniorPoolV2Contract } from "./types/seniorpoolv2";

async function wrtOnBlock(block: Block, ctx: WithdrawalRequestTokenContext) {
    const totalSupply = await ctx.contract.totalSupply()
    ctx.meter.Gauge("wrt_total_supply").record(totalSupply)
    const seniorPool = getSeniorPoolV2Contract(SENIOR_POOL_V2)
    
    for (var i = 1; i < totalSupply.toNumber(); i++) {
        const token = await ctx.contract.tokenByIndex(i)
        const withdrawal = await seniorPool.withdrawalRequest(token)
        const amount = scaleDown(withdrawal.fiduRequested, FIDU_DECIMAL)
        ctx.meter.Gauge("withdrawal_request").record(amount, {"index": i.toString()})
    }
}

async function seniorPoolOnBlock(block: Block, ctx: SeniorPoolV2Context) {
    const currentEpoch = await ctx.contract.currentEpoch()
    const fiduRequested = scaleDown(currentEpoch[1], FIDU_DECIMAL)
    ctx.meter.Gauge("fidu_requested").record(fiduRequested)

}

async function epochEnded(evt: EpochEndedEvent, ctx: SeniorPoolV2Context) {
    const usdcLiquidated = scaleDown(evt.args.usdcAllocated, USDC_DECIMAL)
    ctx.meter.Counter("usdc_liquidated").add(usdcLiquidated)
}

async function withdrawalMade(evt: WithdrawalMadeEvent, ctx: SeniorPoolV2Context) {
    const balance = scaleDown(evt.args.userAmount, USDC_DECIMAL)
    const capital = evt.args.capitalProvider
    if (capital !== ZAPPER) {
        ctx.meter.Counter("usdcClaimed").add(balance)
    }
}

async function withdrawlCanceled(evt: WithdrawalCanceledEvent, ctx: SeniorPoolV2Context) {
    const fee = scaleDown(evt.args.reserveFidu, FIDU_DECIMAL)
    ctx.meter.Counter("num_of_cancel").add(1)
    ctx.meter.Counter("cancel_fee").add(fee)
}


WithdrawalRequestTokenProcessor.bind({address: WRT_ADDR})
.onBlock(wrtOnBlock)

SeniorPoolV2Processor.bind({address: SENIOR_POOL_V2, startBlock: SENIOR_POOL_V2_START})
.onBlock(seniorPoolOnBlock)
.onEventEpochEnded(epochEnded)
.onEventWithdrawalMade(withdrawalMade)
.onEventWithdrawalCanceled(withdrawlCanceled)
