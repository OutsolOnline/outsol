import {Suspense} from 'react'
import {WalletWorkspace,WalletWorkspaceLoading} from '@/components/wallet/WalletWorkspace'
export default function WalletPage(){return <Suspense fallback={<WalletWorkspaceLoading/>}><WalletWorkspace/></Suspense>}
