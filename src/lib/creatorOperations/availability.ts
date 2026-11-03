import {PENDING_KEY} from '../launchHistory'
import {readTradePending} from '../venues/tradeHistory'
import {readPendingWalletOperation} from '../walletOperations/history'
import {assertNoPendingGroupOperation} from '../walletGroups/history'
import {assertNoPendingBundleReceipt} from '../bundler/pending'
import {assertNoUnresolvedRelay} from '../relay/pendingGuard'
import {assertNoUnresolvedSupplyLock} from '../supplyLocks/pendingGuard'
import {creatorStorage,readPendingCreatorOperation,readCreatorOperationHistory,type PendingCreatorOperation} from './history'
import type {CreatorStorage} from './model'

/** Read the other engines' original journals; the caller owns the shared browser submission lock. */
export function assertCreatorOperationAvailable(storage?:CreatorStorage,allowed?:PendingCreatorOperation):void{
 const disk=creatorStorage(storage),current=readPendingCreatorOperation(disk)
 if(allowed?JSON.stringify(current)!==JSON.stringify(allowed):!!current)throw new Error('A creator operation is pending or its recovery record changed. Check its original signature before spending.')
 readCreatorOperationHistory(disk)
 if(disk.getItem(PENDING_KEY)!==null)throw new Error('A launch needs a confirmation check. Open Activity first.')
 if(readTradePending(disk))throw new Error('A trade is pending confirmation. Check it in Holdings & trade first.')
 if(readPendingWalletOperation(disk))throw new Error('A wallet operation is pending confirmation. Check it before continuing.')
 assertNoPendingGroupOperation(disk);assertNoPendingBundleReceipt(disk);assertNoUnresolvedRelay(disk);assertNoUnresolvedSupplyLock(disk)
}
