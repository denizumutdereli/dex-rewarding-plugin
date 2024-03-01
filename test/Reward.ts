/** @author: denizumutdereli */

import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumberish, Signer } from "ethers";
import { RewardSystem, MockDerivativesDEX, MockERC20, MockUSDC } from "../typechain-types";

// Main describe block for the Reward System contract tests
describe("Reward System", function () {
    let rewardSystem: RewardSystem;
    let erc20: MockERC20;
    let usdc: MockUSDC;
    let dex: MockDerivativesDEX;
    let owner:Signer, trader1:Signer, trader2:Signer, trader3:Signer;

    // Constants used throughout the tests
    const initialSupplyERC20 = ethers.parseUnits("1000000", 18);
    const initialSupplyUSDC = ethers.parseUnits("100000", 6); 
    const rewardPerSecond = ethers.parseUnits("0.387", 18); 

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

        // Distribute USDC tokens to traders and approve the DEX to spend them
        for (let trader of [trader1, trader2, trader3]) {
            const address = await trader.getAddress();
            await usdc.transfer(address, initialSupplyUSDC);
            await usdc.connect(trader).approve(dexAddr, initialSupplyUSDC);
        }
    });

    // Helper function for opening a trading position on the DEX
    const openPosition = async (trader: Signer, size: number, isLong: boolean) => {
        await dex.connect(trader).openPosition(size, isLong);
        const address = ((await trader.getAddress()).toLowerCase());
      
        const currentPeriod = await dex.getPeriod();
        const position = await dex.getTraderPositionForPeriod(address, currentPeriod, isLong);

        expect(ethers.toBigInt(position)).to.equal(ethers.toBigInt(size));
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
    };

    // Test suite for trading mechanics
    describe("Trading Mechanics", function () {
        it("should handle trading between users correctly", async function () {
            // Test initial balances and trading operations
            // This test simulates trading activities, ensuring that balances and total volumes are updated accordingly
            const positionSize = ethers.parseUnits("500", 6); // 500 MockUSDC

            const trader1BalanceBeforeTrading = await usdc.balanceOf(await trader1.getAddress());
            expect(trader1BalanceBeforeTrading).to.equal(initialSupplyUSDC);

            const trader2BalanceBeforeTrading = await usdc.balanceOf(await trader1.getAddress());
            expect(trader2BalanceBeforeTrading).to.equal(initialSupplyUSDC);

            const expectedBalanceAfterOpen = initialSupplyUSDC - positionSize;
            const expectedBalanceAfterClose = initialSupplyUSDC; // Assuming the trader gets back the same amount

            // Trader1 opens a long position
            await openPosition(trader1, ethers.getNumber(positionSize), true); //1

            // Trader2 opens a short position
            await openPosition(trader2, ethers.getNumber(positionSize), false); //2

            // After opening a position:
            const trader1BalanceAfterOpen = await usdc.balanceOf(await trader1.getAddress());
            expect(trader1BalanceAfterOpen).to.equal(expectedBalanceAfterOpen);
 
            // Trader1 closes the long position
            await closePosition(trader1, ethers.getNumber(positionSize), true); //3

            // After closing a position:
            const trader1BalanceAfterClose = await usdc.balanceOf(await trader1.getAddress());
            expect(trader1BalanceAfterClose).to.equal(expectedBalanceAfterClose);           

            // Check total market values and user balances
            const totalVolume = await dex.totalVolumePerPeriod(0);
            expect(totalVolume).to.equal(positionSize * BigInt(3));

            // Try to close more than owned position
            await expect(dex.connect(trader1).closePosition(positionSize, true))
                .to.be.revertedWith("Insufficient long position");

            // Withdraw from position with success and failure
            await expect(dex.connect(trader2).withdrawFromPosition(positionSize / BigInt(2), false))
                .to.emit(dex, "PositionCancelled");
            await expect(dex.connect(trader2).withdrawFromPosition(positionSize * BigInt(2), false))
                .to.be.revertedWith("Insufficient short position");
        });
    });

    // Test suite for rewards calculation
    describe("Rewards Calculation", function () {
        const periodDuration = 2592000;
    
        // Trading volumes helper
        async function getTraderVolumes(trader: Signer, period: number): Promise<BigNumberish> {
            const longVolume = await dex.getTraderPositionForPeriod(await trader.getAddress(), period, true);
            const shortVolume = await dex.getTraderPositionForPeriod(await trader.getAddress(), period, false);
            return longVolume + shortVolume;
        }
    
        // Simulation helper
        async function simulateTradingAndAdvanceTime(): Promise<void> {
            // Simulate some trading activity
            const tradingVolume = ethers.parseUnits("1000", 6); 

            await openPosition(trader1, ethers.getNumber(tradingVolume), true);
            await openPosition(trader2, ethers.getNumber(tradingVolume), false);
            await openPosition(trader3, ethers.getNumber(tradingVolume), true);
    
            await closePosition(trader1, ethers.getNumber(tradingVolume)/2, true);
            await closePosition(trader2, ethers.getNumber(tradingVolume)/4, false);
            await closePosition(trader3, ethers.getNumber(tradingVolume)/5, true);
    
            // Advance time to end the period
            await network.provider.send("evm_increaseTime", [periodDuration]);
            await network.provider.send("evm_mine");
        }

        // Simulation helper proxy
        async function simulateTradingAndAdvanceTimeForGivenPeriod(period: number = 0): Promise<[bigint, bigint]> {
            let totalMarketVolume = await dex.getCumulativeMarketVolume(period);
            let rewardRatePerSecond = BigInt(rewardPerSecond.toString()); 

            if (totalMarketVolume == BigInt(0)) {
                return [BigInt(0), BigInt(0)];
            }

            // Convert totalMarketVolume to bigint for calculations
            totalMarketVolume = BigInt(totalMarketVolume.toString());

            // Placeholder for aggregated results, modify as needed
            let totalActualReward: bigint = BigInt(0);
            let totalExpectedReward: bigint = BigInt(0);

            for (const trader of [trader1, trader2, trader3]) {
                const traderVolume = await getTraderVolumes(trader, period);
                const expectedReward = (BigInt(traderVolume) * rewardRatePerSecond) / totalMarketVolume;

                // Claim rewards for the trader
                await rewardSystem.connect(trader).claimRewards(period);

                // Verify the trader's reward
                const actualReward = BigInt((await erc20.balanceOf(await trader.getAddress())).toString());

                // Aggregate results
                totalActualReward += actualReward;
                totalExpectedReward += expectedReward;
            }

            // Return the aggregated results
            return [totalActualReward, totalExpectedReward];
        }
        
        it("correctly calculates individual trader rewards after one period", async function () {
            // Simulate a period of trading and verify that rewards are distributed correctly
            await simulateTradingAndAdvanceTime();
            const [totalActualReward, totalExpectedReward] = await simulateTradingAndAdvanceTimeForGivenPeriod(0);
            const tolerance = BigInt(ethers.parseUnits("0.01", 18).toString());
            expect(ethers.getBigInt(totalActualReward)).to.be.closeTo(ethers.getBigInt(totalExpectedReward), 
            ethers.getBigInt(tolerance));
        });

        it("correctly calculates individual traders not to rewarded", async function () {
            // Ensure traders who haven't participated do not receive rewards
            const tradingVolume = ethers.parseUnits("1000", 6); 

            await openPosition(trader1, ethers.getNumber(tradingVolume), true);

            // Advance time to end the period
            await network.provider.send("evm_increaseTime", [periodDuration*2]);
            await network.provider.send("evm_mine");
            await expect(rewardSystem.connect(trader1).claimRewards(1)).to.be.revertedWith("Reward below minimum claim amount");
        });
    
        it("resets rewards correctly after each period", async function () {
            // Verify that rewards are reset correctly after the end of each period
            const tradingVolume = ethers.parseUnits("1000", 6); 
            let period = await dex.getPeriod();
            
            await openPosition(trader1, ethers.getNumber(tradingVolume), true);

            await expect(rewardSystem.connect(trader1).claimRewards(period)).to.be.revertedWith("Cannot claim for future periods");

            // Advance time to end the period
            await network.provider.send("evm_increaseTime", [periodDuration]);
            await network.provider.send("evm_mine");

            period = await dex.getPeriod();

            await expect(rewardSystem.connect(trader1).claimRewards(period-BigInt(1))).to.be.revertedWith("Trader not participated in this period");

            // Create a new position in new period.
            await openPosition(trader1, ethers.getNumber(tradingVolume), true);

            await closePosition(trader1, ethers.getNumber(tradingVolume/BigInt(2)), true);

            // Advance time to end the period
            await network.provider.send("evm_increaseTime", [periodDuration]);
            await network.provider.send("evm_mine");

            // Try to claim previous one again.
            await rewardSystem.connect(trader1).claimRewards(1);
            await expect(rewardSystem.connect(trader1).claimRewards(1)).to.be.revertedWith("Rewards already claimed for this period");
        });
        
    });

    // Test suite for owner-specific functionalities like pausing and unpausing the system.
    describe("Owner - Pause and Unpause Mechanics", function () {
        beforeEach(async function () {
            if(await rewardSystem.paused()) {
                await rewardSystem.connect(owner).unpause();
            }
        });
        
        it("should prevent reward claiming when the system is paused", async function () {
            // Test the pausing functionality and its impact on reward claiming

            // Pause the system
            await rewardSystem.connect(owner).pause();
            
            // Confirm the system is paused
            expect(await rewardSystem.paused()).to.be.true;
            
            // Attempt to claim rewards while paused
            await expect(rewardSystem.connect(trader1).claimRewards(0))
                .to.be.reverted;
        });
                   
        it("should prevent pausing and unpausing by unauthorized users", async function () {
            // Ensure only the owner can pause and unpause the reward system.

            // Attempt to pause and unpause by a non-owner
            await expect(rewardSystem.connect(trader1).pause())
                .to.be.revertedWith("Ownable: caller is not the owner");
            
            await expect(rewardSystem.connect(trader1).unpause())
                .to.be.revertedWith("Ownable: caller is not the owner");
        });
    });
    
    // Test suite for analyzing gas consumption
    describe("Gas Consumption Mechanics", function () {
        it("should manage gas efficiently for trading operations", async function () {
            // Analyze the gas used for opening and closing positions to ensure efficiency.
            const expectedGasLimitForOpening = ethers.parseUnits("200000", "wei");
            const expectedGasLimitForClosing = ethers.parseUnits("150000", "wei"); 
    
            const positionSize = ethers.parseUnits("500", 6); // 500 MockUSDC
            
            // Opening a long position
            const openTx = await dex.connect(trader1).openPosition(Number(positionSize), true);
            const openReceipt = await openTx.wait();
            const openGasUsed = openReceipt!.gasUsed;
            console.log(`Gas used for opening a position: ${openGasUsed.toString()}`);
            expect(openGasUsed).to.be.below(BigInt(expectedGasLimitForOpening.toString()));
    
            // Closing a long position
            const closeTx = await dex.connect(trader1).closePosition(Number(positionSize), true);
            const closeReceipt = await closeTx.wait();
            const closeGasUsed = closeReceipt!.gasUsed;
            console.log(`Gas used for closing a position: ${closeGasUsed.toString()}`);
            expect(closeGasUsed).to.be.below(BigInt(expectedGasLimitForClosing.toString()));
        });
    });

});
