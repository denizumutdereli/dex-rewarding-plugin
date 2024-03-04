# Decentralized Derivatives Exchange (DEX) and Reward System on Ethereum

## Overview
This project showcases a Decentralized Derivatives Exchange (DEX) integrated with a Reward System. Designed for the Ethereum blockchain, it leverages smart contracts to simulate trading derivatives with USDC and rewards active traders based on market contribution and engagement.

## Core Components
### MockDerivativesDEX.sol
Simulates derivatives trading. Supports opening, maintaining, and closing positions with different leverage options. Incorporates period-based market evaluation for managing trades.

### RewardSystem.sol
Distributes rewards to active traders based on their market participation and the total volume they contribute, relative to the overall market activity.

### MockUSDC.sol & MockERC20.sol
Mock implementations for USDC (with 6 decimals) and a generic ERC20 token (with 18 decimals) used to simulate trading and rewards. Ensures precise scaling and interaction between different decimal standards.

## Key Features and Mechanisms
- **Trading Mechanics**: Supports derivative trades with precise handling of USDC decimals. Users can open long or short positions, which remain independent of trading periods. Including Withdraw functionality where wds are not count for trading.
  
- **Period-Based Calculations**: The DEX operates in fixed periods, allowing for systematic settlement and reward calculations. Each period aggregates total market volume and user participation separately.

- **Reward Distribution**: Rewards are only given to users who actively participate in trading, marked by opening and/or closing positions within a period. Simply holding a position does not count as active participation.

- **Participation Validation**: A user's activity is validated by their number of actions within a period. Opening a position does not automatically qualify for rewards; the user must also perform a closing action to be considered an active participant.

- **Security and Efficiency**: Contracts are secured with reentrancy guards and optimized for gas efficiency. Extensive testing covers a wide range of scenarios to ensure contract integrity and user safety.

## Testing and Validation
Extensive tests cover:
- **Different Decimals Handling**: Ensures accurate operations between tokens with different decimal places.
- **Independent Period Mechanisms**: Verifies that positions can span multiple periods without unintended consequences.
- **Active Participation Checks**: Confirms that only genuinely active users receive rewards, based on their contributions and actions.
- **Gas Consumption Analysis**: Benchmarks and optimizes gas usage for all contract functions, ensuring cost-effective operations.

## Development Setup
1. **Environment Setup**: Clone the repository and install dependencies via `npm install`.
2. **Contract Compilation**: Compile contracts with `npx hardhat compile`.
3. **Running Tests**: Execute `npx hardhat test` to run the test suites and validate contract functionalities.

## Deployment Guide
Detailed steps for deploying on testnets (e.g., Mumbai, Sepolia):
1. Configure `.env` with network settings and private keys.
2. Run deployment scripts via `npx hardhat run scripts/deploy.ts --network <network-name>`.
3. Verify contracts on Etherscan for public transparency.

## Usage Instructions
Follow these steps to engage with the DEX and Reward System:
1. **Trading**: Use MockUSDC to open and close derivative positions on the DEX.
2. **Active Participation**: Ensure to perform both opening and closing actions within trading periods to qualify for rewards.
3. **Claiming Rewards**: Post-period, check your eligibility and claim your earned rewards through the Reward System contract.

## Post Deployment Info
MockUSDC deployed to: [0x965Dc32e960F18C1DdaCe820D34f581fa789D26f](https://sepolia.etherscan.io/address/0x965Dc32e960F18C1DdaCe820D34f581fa789D26f)

MockDerivativesDEX deployed to: [0x5C2D4F09A9EDb6C9bbBC68a56f7600d27Cf609a6](https://sepolia.etherscan.io/address/0x5C2D4F09A9EDb6C9bbBC68a56f7600d27Cf609a6)

MockERC20 deployed to: [0x3f65cC62Aa9C5AbD07a8dAe71E3222d8C65642aF](https://sepolia.etherscan.io/address/0x3f65cC62Aa9C5AbD07a8dAe71E3222d8C65642aF)

RewardSystem deployed to: [0xC00E5ef27833fde0f324137873D28b2c72ecC893](https://sepolia.etherscan.io/address/0xC00E5ef27833fde0f324137873D28b2c72ecC893)

Minted 1000000000000000000000000 MockERC20 tokens to RewardSystem

## Contributing

Contributions to expand or improve the repository are welcome! 

[@denizumutdereli](https://www.linkedin.com/in/denizumutdereli)
