import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from 'dotenv';
dotenv.config();

function getEnvVariable(key: string, defaultValue: string = ''): string {
  const value = process.env[key];
  if (typeof value === 'string') {
      return value;
  }
  if (defaultValue) return defaultValue;
  throw new Error(`Environment variable ${key} is not set.`);
}

const PRIVATE_KEY = getEnvVariable('PRIVATE_KEY');
const ACCOUNTS = PRIVATE_KEY ? [`0x${PRIVATE_KEY}`] : [];

const MUMBAI_URL = getEnvVariable('MUMBAI_URL');
const SEPOLIA_URL = getEnvVariable('SEPOLIA_URL');
const ETHERSCAN_API_KEY = getEnvVariable('ETHERSCAN_API_KEY', '');

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },
  networks: {
    mumbai: {
        url: MUMBAI_URL,
        accounts: ACCOUNTS,
    },
    sepolia: {
        url: SEPOLIA_URL,
        accounts: ACCOUNTS,
    }
  },
    etherscan: {
        apiKey: ETHERSCAN_API_KEY,
    },
};

export default config;
