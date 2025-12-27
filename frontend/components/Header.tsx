import React from 'react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'

export const Header: React.FC = () => {
  return (
    <header style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <h1>Roulette Table</h1>
      <WalletMultiButton />
    </header>
  )
}

export default Header
