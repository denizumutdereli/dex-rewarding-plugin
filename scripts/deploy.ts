import { ethers } from "hardhat";

/**
 * @author denizumutdereli
 * 
 * @dev -post-deployment:
 * 
    Starting the deploy...
    MockUSDC deployed to: 0x3008f2aF7b9123BC740CcBdC3db09707ABA11A35
    MockDerivativesDEX deployed to: 0x6948d1b74Be80320e116A8640052bDA16b8014a6
    MockERC20 deployed to: 0xa96c66381CFb2DFDa50429a0e6B1Bf0b8bFC7A18
    RewardSystem deployed to: 0x03605fCa263753043Bd7D1cBD45FaF1833287354
    Minted 1000000000000000000000000 MockERC20 tokens to RewardSystem
 */


async function main() {
  console.log("Starting the deploy...");
  // Deploy MockUSDC
  const USDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await USDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log("MockUSDC deployed to:", usdcAddr);

  // Deploy MockDerivativesDEX
  const Dex = await ethers.getContractFactory("MockDerivativesDEX");
  const dex = await Dex.deploy(usdcAddr);
  await dex.waitForDeployment();
  const dexAddr = await dex.getAddress();
  console.log("MockDerivativesDEX deployed to:", dexAddr);

  // Deploy MockERC20
  const ERC20 = await ethers.getContractFactory("MockERC20");
  const erc20 = await ERC20.deploy();
  await erc20.waitForDeployment();
  const erc20Addr = await erc20.getAddress();
  console.log("MockERC20 deployed to:", erc20Addr);

  // Deploy RewardSystem
  const RewardSystem = await ethers.getContractFactory("RewardSystem");
  const rewardSystem = await RewardSystem.deploy(erc20Addr, dexAddr);
  await rewardSystem.waitForDeployment();
  const rewardSystemAddr = await rewardSystem.getAddress();
  console.log("RewardSystem deployed to:", rewardSystemAddr);

  // Set Rewardsystem Address to dex platform
  await dex.setRewardingPluginAddress(rewardSystemAddr);

  // Mint ERC20 tokens to the RewardSystem
  const initialSupplyERC20 = ethers.parseUnits("1000000", 18);
  await erc20.mint(rewardSystemAddr, initialSupplyERC20);
  console.log(`Minted ${initialSupplyERC20.toString()} MockERC20 tokens to RewardSystem`);

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
