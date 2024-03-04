/** @author: denizumutdereli */

import { expect } from "chai";
import { ethers } from "hardhat";
import { RewardSystem, MockDerivativesDEX, MockERC20, MockUSDC } from "../typechain-types";
import { Signer } from "ethers";

function delay(ms:number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Main describe block for the Reward System contract tests
describe("Reward System", function () {
        
    let rewardSystem: RewardSystem;
    let erc20: MockERC20;
    let usdc: MockUSDC;
    let dex: MockDerivativesDEX;
    let owner: Signer, trader1: Signer, trader2: Signer, trader3: Signer;

    // Constants used throughout the tests
    const initialSupplyERC20 = ethers.parseUnits("1000000", 18);
    const initialSupplyUSDC = ethers.parseUnits("100000", 6); 

    // This beforeEach block sets up the test environment for each test
    beforeEach(async function () {
        [owner, trader1, trader2, trader3] = await ethers.getSigners();

        // Deploy mock USDC token and allocate initial supply
        const USDC = await ethers.getContractFactory("MockUSDC");
        usdc = await USDC.deploy();
        await usdc.waitForDeployment();
        const usdcAddr = await usdc.getAddress();

        // Deploy mock ERC20 token for rewards and allocate initial supply
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        erc20 = await MockERC20.deploy();
        await erc20.waitForDeployment();
        const erc20Addr = await erc20.getAddress();

        // Deploy the mock derivatives DEX and initialize with USDC
        const MockDerivativesDEX = await ethers.getContractFactory("MockDerivativesDEX");
        dex = await MockDerivativesDEX.deploy(
            usdcAddr
        );
        await dex.waitForDeployment();
        const dexAddr = dex.getAddress(); 

        // Deploy the Reward System contract and initialize with ERC20 and DEX addresses
        const RewardSystem = await ethers.getContractFactory("RewardSystem");
        rewardSystem = await RewardSystem.deploy(erc20Addr, dexAddr);
        await rewardSystem.waitForDeployment();
        const rewardSystemAddr = await rewardSystem.getAddress();

        // Mint and allocate reward tokens to the reward system
        await erc20.mint(rewardSystemAddr, initialSupplyERC20);

        // Set the reward system contract as a rewarding plugin in the DEX
        await dex.setRewardingPluginAddress(rewardSystemAddr);

        // Distribute USDC tokens to traders and approve the DEX to spend them
        for (let trader of [trader1, trader2, trader3]) {
            const address = await trader.getAddress();
            await usdc.transfer(address, initialSupplyUSDC);
            await usdc.connect(trader).approve(dexAddr, initialSupplyUSDC);
        }
    });

    // Helper function for opening a trading position on the DEX
    
    const switchCoolDown = async(owner:Signer, _newPeriod:number ) => {
        const tx = await await dex.connect(owner).updateCoolDownPeriod(_newPeriod);
        expect(tx).to.emit(dex, "CoolDownPeriodUpdated").withArgs(_newPeriod);
    }
    
    const openPosition = async (trader: Signer, size: number, isLong: boolean) => {
        await dex.connect(trader).openPosition(size, isLong);
        const address = ((await trader.getAddress()).toLowerCase());
        
        const currentPeriod = await dex.getPeriod();
        const position = await dex.getTraderPositionForPeriod(address, currentPeriod, isLong);

        expect(ethers.toBigInt(position)).to.equal(ethers.toBigInt(size));
        await delay(500);
    };

    // Helper function for closing a trading position on the DEX
    const closePosition = async (trader:Signer, size:number, isLong:boolean) => {
        await dex.connect(trader).closePosition(size, isLong);
        const position = await dex.getTraderPositions(await trader.getAddress(), isLong);
        let totalPositions;
        isLong ? 
        totalPositions = await dex.traderLongPositions(await trader.getAddress()) :
        totalPositions = await dex.traderShortPositions(await trader.getAddress());

        const expectedPositionSize = position
        expect(expectedPositionSize).to.equal(totalPositions);
        await delay(500);
    };

    // Test cases
    describe("Claim Rewards", function () {
        beforeEach(async () => {
            switchCoolDown(owner,0);
        });

        it("should allow a trader to claim rewards after trading activity", async function () {
        // This test simulates trading activities, ensuring that balances and total volumes are updated accordingly
        const positionSize = ethers.parseUnits("500", 6); // 500 MockUSDC

        // Trader1 opens a long position
        await openPosition(trader1, ethers.getNumber(positionSize), true); //1

        // Trader2 opens a short position
        await openPosition(trader2, ethers.getNumber(positionSize), false); //2


        await closePosition(trader1, ethers.getNumber(positionSize), true);

        // After opening a position:
        const trader1BalanceAfterOpen = await erc20.balanceOf(await trader1.getAddress());
        expect(trader1BalanceAfterOpen).to.equal(0);

        await expect(rewardSystem.connect(trader1).claimRewards(await dex.getPeriod()))
        .to.be.revertedWith("Cannot claim for ongoing or future periods");

        // Wait until next period
        await ethers.provider.send("evm_increaseTime", [2592000]);
        await ethers.provider.send("evm_mine", []);

        // Claim rewards for trader1
        const period = await dex.getPeriod() - BigInt(1); // Previous period

        // trader 1 reward amount:
        const rewards = await dex.claimableRewards(await trader1.getAddress(), 0);// from first period
        expect(rewards[1]).to.be.above(0);

        await expect(rewardSystem.connect(trader1).claimRewards(0))
            .to.emit(rewardSystem, "RewardClaimed")
            .withArgs(trader1.getAddress(), rewards[1]);

        await delay(1000);
        // try to re-claim
        await expect(rewardSystem.connect(trader1).claimRewards(0)) 
            .to.revertedWith("Previously claimed for this period");

        // new trade in new period so there wont be a claimable amount yet
        await openPosition(trader1, ethers.getNumber(positionSize), true); //1

        await expect(rewardSystem.connect(trader1).claimRewards(await dex.getPeriod()))
        .to.be.revertedWith("Cannot claim for ongoing or future periods");

        });

        it("should not allow a trader to claim rewards for the same period twice", async function () {
            const positionSize = ethers.parseUnits("500", 6); // 500 MockUSDC

            await openPosition(trader1, ethers.getNumber(positionSize), true); //1

            await closePosition(trader1, ethers.getNumber(positionSize), true); //1
            await openPosition(trader2, ethers.getNumber(positionSize), true); //2
            
            await ethers.provider.send("evm_increaseTime", [2592001]);
            await ethers.provider.send("evm_mine", []);

            // Try to claim again for the same period
            await rewardSystem.connect(trader1).claimRewards(0);
            await expect(rewardSystem.connect(trader1).claimRewards(0))
                .to.be.revertedWith("Previously claimed for this period");
        });

        it("should not allow claiming rewards if the trader did not participate in the period", async function () {
            // Wait until next period
            await ethers.provider.send("evm_increaseTime", [2592000]);
            await ethers.provider.send("evm_mine", []);

            // trader2 did not participate in any trading activity
            const period = await dex.getPeriod() // Previous period
            await expect(rewardSystem.connect(trader2).claimRewards(period-BigInt(1)))
                .to.be.revertedWith("Not participated and not eligible for rewards");
        });
    });

});