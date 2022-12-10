import { FiduContext, FiduProcessor, getFiduContract } from "./types/fidu";
import {
    MembershipCollectorContext,
    MembershipCollectorProcessor,
    EpochFinalizedEvent
} from "./types/membershipcollector";
import { Gauge } from "@sentio/sdk";
import {
    Membership_Collector,
    FIDU,
    GFI_DECIMAL,
    Membership_Collector_Starting_Block,
    FIDU_DECIMAL,
    GFI_Ledger,
    Capital_Ledger,
    USDC_DECIMAL,
    Membership_Vault,
    STAKED_FIDU,
    FROM_ADDRESS_SET,
    POOL_TOKEN,
    GFI_TOKEN
} from "./constant";
import type { Block } from '@ethersproject/providers'
import { scaleDown } from '@sentio/sdk/lib/utils/token'
import { GFILedgerProcessor, GFILedgerContext, GFIDepositEvent, GFIWithdrawalEvent } from './types/gfiledger'
import {
    CapitalLedgerProcessor,
    CapitalLedgerContext,
    CapitalERC721DepositEvent,
    CapitalERC721WithdrawalEvent,
    getCapitalLedgerContract
} from "./types/capitalledger"
import { getMembershipVaultContract } from './types/membershipvault'
import { getAssetType } from './helpers'
import { ERC20Context, ERC20Processor, TransferEvent } from '@sentio/sdk/lib/builtin/erc20'

async function fiduBlockHandler(block: Block, ctx: FiduContext) {
    const balance = scaleDown(await ctx.contract.balanceOf(Membership_Collector), FIDU_DECIMAL)
    ctx.meter.Gauge("membership_fidu_balance").record(balance)
}

const sparseGauge = Gauge.register("fidu_at_epoch_sparse", { sparse: true })

async function epochFinalizedHandler(evt: EpochFinalizedEvent, ctx: MembershipCollectorContext) {
    const epoch = evt.args.epoch
    const totalRewards = evt.args.totalRewards
    const block = evt.blockNumber
    const balance = scaleDown(await getFiduContract(FIDU).balanceOf(Membership_Collector, {blockTag: evt.blockNumber}), FIDU_DECIMAL)
    ctx.meter.Gauge("fidu_at_epoch").record(balance)
    sparseGauge.record(ctx, balance)
    const membershipVaultContract = getMembershipVaultContract(Membership_Vault)

    const numOfOwners = await membershipVaultContract.totalSupply({blockTag: block})
    const totalAtEpoch = await membershipVaultContract.totalAtEpoch(epoch, {blockTag: block})
    // position ID is 1-based
    for (var i = 1; i <= numOfOwners.toNumber(); i++) {
        const owner = await membershipVaultContract.ownerOf(i, {blockTag: block})
        const value = await membershipVaultContract.currentValueOwnedBy(owner, {blockTag: block})
        var reward
        if (!totalAtEpoch.eq(0)) {
            reward = value.div(totalAtEpoch).mul(totalRewards)
        } else {
            reward = 0
        }
        ctx.meter.Gauge("user_reward").record(reward, {"owner": owner})
    }
}

async function gfiDeposit(evt: GFIDepositEvent, ctx: GFILedgerContext) {
    const balance = scaleDown(evt.args.amount, GFI_DECIMAL)
    const owner = evt.args.owner
    ctx.meter.Counter("gfi_deposit_counter").add(balance, {"owner": owner})
    ctx.meter.Gauge("gfi_deposit").record(balance)
    ctx.meter.Counter("gfi_balance_counter").add(balance)

}

async function gfiWithdrawal(evt: GFIWithdrawalEvent, ctx: GFILedgerContext) {
    const balance = scaleDown(evt.args.withdrawnAmount, GFI_DECIMAL)
    ctx.meter.Counter("gfi_withdrawal_counter").add(balance)
    ctx.meter.Gauge("gfi_withdrawal").record(balance)
    ctx.meter.Counter("gfi_balance_counter").sub(balance)
}

async function capitalErc721Deposit(evt: CapitalERC721DepositEvent, ctx: CapitalLedgerContext) {
    const balance = scaleDown(evt.args.usdcEquivalent, USDC_DECIMAL)
    const assetAddress = evt.args.assetAddress.toLowerCase()
    const ownerAddress = evt.args.owner
    const assetType = getAssetType(assetAddress)

    ctx.meter.Counter("capital_deposit_usdc_counter").add(balance, {"asset_type": assetType, "owner": ownerAddress})
    ctx.meter.Gauge("capital_deposit_usdc").record(balance, {"asset_type": assetType, "owner": ownerAddress})
    ctx.meter.Counter("capital_balance_counter").add(balance, {"asset_type": assetType, "owner": ownerAddress})


}

async function capitalErc721Withdrawal(evt: CapitalERC721WithdrawalEvent, ctx: CapitalLedgerContext) {
    const positionId = evt.args.positionId
    const assetAddress = evt.args.assetAddress
    const assetType = getAssetType(assetAddress)
    const position = await getCapitalLedgerContract(Capital_Ledger).positions(positionId, { blockTag: evt.blockNumber - 1})

    // adding these tags for debug purpose, should be removed in offical release
    const ownerAddress = evt.args.owner
    // const positionOwner = position.owner

    const balance = scaleDown(position.usdcEquivalent, USDC_DECIMAL)

    ctx.meter.Counter("capital_withdrawal_usdc_counter").add(balance, {"asset_type": assetType, "owner": ownerAddress})
    ctx.meter.Gauge("capital_withdrawal_usdc").record(balance, {"asset_type": assetType, "owner": ownerAddress})
    ctx.meter.Counter("capital_balance_counter").sub(balance, {"asset_type": assetType, "owner": ownerAddress})
}

async function gfiTransferEvent(evt: TransferEvent, ctx: ERC20Context) {
    const from = evt.args.from
    if (FROM_ADDRESS_SET.has(from.toLowerCase())) {
        const to = evt.args.to
        const amount = scaleDown(evt.args.value, GFI_DECIMAL)
        ctx.meter.Counter("gfi_from_exchanges").add(amount, {"owner": to})
    }
}

//only start processing after Membership Collector is deployed
FiduProcessor.bind({address: FIDU, startBlock: Membership_Collector_Starting_Block})
.onBlock(fiduBlockHandler)

MembershipCollectorProcessor.bind({address: Membership_Collector})
.onEventEpochFinalized(epochFinalizedHandler)

GFILedgerProcessor.bind({address: GFI_Ledger})
.onEventGFIDeposit(gfiDeposit)
.onEventGFIWithdrawal(gfiWithdrawal)

CapitalLedgerProcessor.bind({address: Capital_Ledger})
.onEventCapitalERC721Deposit(capitalErc721Deposit)
.onEventCapitalERC721Withdrawal(capitalErc721Withdrawal)

ERC20Processor.bind({address: GFI_TOKEN})
.onEventTransfer(gfiTransferEvent)