/** @author: denizumutdereli */

import { expect } from "chai";
import { ethers } from "hardhat";
import { MockDerivativesDEX, MockUSDC } from "../typechain-types";
import "@nomicfoundation/hardhat-toolbox";
import { Signer, toBigInt } from "ethers";

function delay(ms:number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// A comprehensive testing suite for the Mock Derivatives DEX functionalities
describe("MockDerivativesDEX", function () {
    // Define test scoped variables for easy access throughout tests
    let mockUSDC: MockUSDC;
    let dex: MockDerivativesDEX;
    let owner:Signer, trader1:Signer, trader2:Signer, trader3:Signer;

    // Initial USDC supply for each trader to simulate realistic starting conditions
    const initialSupply = ethers.parseUnits("10000", 6); // 10,000 MockUSDC for each trader

    // Pre-test setup: Deploy contracts, allocate tokens, and set up approvals
    beforeEach(async () => {
        [owner, trader1, trader2, trader3] = await ethers.getSigners();

        // Deploy MockUSDC contract and distribute initial supply
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        mockUSDC = await MockUSDC.deploy();
        await mockUSDC.waitForDeployment();

        // Deploy the Derivatives DEX with MockUSDC address
        const MockDerivativesDEX = await ethers.getContractFactory("MockDerivativesDEX");
        dex = await MockDerivativesDEX.deploy(await mockUSDC.getAddress());
        await dex.waitForDeployment();

        // Distribute initial USDC supply and set approval for DEX
        for (let trader of [trader1, trader2, trader3]) {
            const address = await trader.getAddress();
            await mockUSDC.transfer(address, initialSupply);
            await mockUSDC.connect(trader).approve(await dex.getAddress(), initialSupply);
        }
    });

    // Helper function to open a trading position on the DEX

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

    // Helper function to close a trading position on the DEX
    const closePosition = async (trader:Signer, size:number, isLong:boolean) => {
        await dex.connect(trader).closePosition(size, isLong);
        const currentPeriod = await dex.getPeriod();
        const position = await dex.getTraderPositionForPeriod(await trader.getAddress(), currentPeriod, isLong);
        const expectedPositionSize = position
        // Traders close positions with specified size and direction
        expect(expectedPositionSize).to.equal(0);
        await delay(500);
    };

    // Initial state test to ensure smart contracts are deployed correctly
    describe("Deployment and Initial State", function () {
        it("should correctly deploy with initial settings", async function () {
            // Confirm the MockUSDC contract address matches the address set in DEX contract
            expect(await dex.USDCToken()).to.equal(await mockUSDC.getAddress());
        });
    });

    // Testing suite for trading mechanics of the DEX
    describe("Trading Mechanics", function () {
        beforeEach(async () => {
            switchCoolDown(owner,0);
        });
            
        it("should revert txs due cool down operation", async function () {
            
            const positionSize = ethers.parseUnits("500", 6); // 500 MockUSDC

            await openPosition(trader1, ethers.getNumber(positionSize), true); //1

            // Trader2 opens a short position
            const coolDownViolence = await openPosition(trader1, ethers.getNumber(positionSize), false); //2

            expect(coolDownViolence).to.revertedWith("Cooldown period has not elapsed");
        });


        it("should handle trading between users correctly", async function () {
            
            const positionSize = ethers.parseUnits("500", 6); // 500 MockUSDC

            const trader1BalanceBeforeTrading = await mockUSDC.balanceOf(await trader1.getAddress());
            expect(trader1BalanceBeforeTrading).to.equal(initialSupply);

            const trader2BalanceBeforeTrading = await mockUSDC.balanceOf(await trader1.getAddress());
            expect(trader2BalanceBeforeTrading).to.equal(initialSupply);

            const expectedBalanceAfterOpen = initialSupply - positionSize;
            const expectedBalanceAfterClose = initialSupply;

            // Trader1 opens a long position
            await openPosition(trader1, ethers.getNumber(positionSize), true); //1

            // Trader2 opens a short position
            await openPosition(trader2, ethers.getNumber(positionSize), false); //2

            // After opening a position:
            const trader1BalanceAfterOpen = await mockUSDC.balanceOf(await trader1.getAddress());
            expect(trader1BalanceAfterOpen).to.equal(expectedBalanceAfterOpen);
 
            // Trader1 closes the long position
            await closePosition(trader1, ethers.getNumber(positionSize), true); //3

            // After closing a position:
            const trader1BalanceAfterClose = await mockUSDC.balanceOf(await trader1.getAddress());
            expect(trader1BalanceAfterClose).to.equal(expectedBalanceAfterClose);           

            // Check total market values and user balances
            const totalVolume = await dex.totalVolumePerPeriod(0);
            expect(totalVolume).to.equal(positionSize * BigInt(3));

            // Try to close more than owned position
            await expect(dex.connect(trader1).closePosition(positionSize, true))
                .to.be.revertedWith("Insufficient long position");
        });
    });

    // Test interactions among multiple users within the DEX environment
    describe("Multiple User Interactions", function () {
        
        beforeEach(async () => {
            switchCoolDown(owner,0);
        });

        it("allows multiple users to open and close positions within the same period", async function () {
            const size = ethers.parseUnits("100", 6); // 100 MockUSDC
        
            await openPosition(trader1, ethers.getNumber(size), true);
            await openPosition(trader2, ethers.getNumber(size), false);
        
            await closePosition(trader1, ethers.getNumber(size), true);
            await closePosition(trader2, ethers.getNumber(size), false);
        
            const totalLong = await dex.totalLongPool(await dex.getPeriod());
            const totalShort = await dex.totalShortPool(await dex.getPeriod());
            expect(totalLong).to.equal(0);
            expect(totalShort).to.equal(0);
        });
    
        it("prevents users from closing more than their open positions", async function () {
            // Ensure traders cannot close positions exceeding their current open positions
            const size = ethers.parseUnits("50", 6); // Örneğin 50 MockUSDC
            await openPosition(trader1, ethers.getNumber(size), true);

            const moreSize = ethers.getNumber(size * toBigInt(2))

            await expect(dex.connect(trader1).closePosition(moreSize, true))
                .to.be.revertedWith("Insufficient long position");
        });
    
        // Test suite for ensuring the continuity of positions across different trading periods
        describe("Position Continuity Across Periods", function () {
            it("should carry forward open positions to subsequent periods correctly", async function () {
                
                const initialSize = ethers.parseUnits("200", 6); // 200 MockUSDC
            
                await openPosition(trader1, ethers.getNumber(initialSize), true);
            
                await ethers.provider.send("evm_increaseTime", [2592000]); 
                await ethers.provider.send("evm_mine", []);
        
                const positionLong = await dex.getTraderPositions(await trader1.getAddress(), true);
                const positionShort = await dex.getTraderPositions(await trader1.getAddress(), false); 
        
                expect(positionLong).to.equal(initialSize);
                expect(positionShort).to.equal(0);
            });
        });
        
        
    });

    // Fuzzy testing for complex scenarios like fractional positions and time travel
    describe("Fuzzy testing: Fractional Position Handling and Time Advance Scenario", function () {
        
        beforeEach(async () => {
            switchCoolDown(owner,0);
        });

        it("allows multiple users to open, close, and interact with fractional positions over different periods", async function () {
            // Simulate and validate the handling of fractional trading positions across different time frames

            // Define fractional position sizes
            const sizeTrader1Open = ethers.parseUnits("150.25", 6);
            const sizeTrader2Open = ethers.parseUnits("175.75", 6);
            const sizeTrader3Open = ethers.parseUnits("125.50", 6);
    
            // Open positions for Trader 1, Trader 2, and Trader 3
            await openPosition(trader1, ethers.getNumber(sizeTrader1Open), true);
            await openPosition(trader2, ethers.getNumber(sizeTrader2Open), false);
            await openPosition(trader3, ethers.getNumber(sizeTrader3Open), true);
    
            // Close positions for Trader 1 and Trader 2, leave Trader 3's position open
            await closePosition(trader1, ethers.getNumber(sizeTrader1Open), true);
            await closePosition(trader2, ethers.getNumber(sizeTrader2Open), false);
    
            // Advance time by one hour to move to the next period
            await ethers.provider.send("evm_increaseTime", [2592000 * 2]); // 1 hour
            await ethers.provider.send("evm_mine", []);
    
            // Trader 3 attempts to close position in the new period but should instead withdraw
    
            // Re-open and close positions for Trader 1 and Trader 2 in the new period
            await openPosition(trader1, ethers.getNumber(sizeTrader2Open), false);
            await openPosition(trader2, ethers.getNumber(sizeTrader1Open), true);
            await closePosition(trader1, ethers.getNumber(sizeTrader2Open), false);
            await closePosition(trader2, ethers.getNumber(sizeTrader1Open), true);
    
            // Validate final balances and total market volume
            const finalTrader1Balance = await mockUSDC.balanceOf(await trader1.getAddress());
            const finalTrader2Balance = await mockUSDC.balanceOf(await trader2.getAddress());
    
            // Validate expected balances considering all transactions
            const expectedBalanceTrader1 = initialSupply;
            const expectedBalanceTrader2 = initialSupply;
    
            expect(finalTrader1Balance).to.equal(expectedBalanceTrader1);
            expect(finalTrader2Balance).to.equal(expectedBalanceTrader2);
    
            // Validate total market volume across periods
            const finalTotalVolume = await dex.totalVolumePerPeriod(await dex.getPeriod());
            const expectedTotalVolume = (sizeTrader1Open + sizeTrader2Open) * toBigInt(2); // Count each transaction twice
    
            expect(finalTotalVolume).to.equal(expectedTotalVolume);
        });
    });

    // Test suite for ensuring the continuity of positions across different trading periods
    describe("Position Continuity Across Periods", function () {
        beforeEach(async () => {
            switchCoolDown(owner,0);
        });

        it("should carry forward open positions to subsequent periods correctly", async function () {
            // Test that positions remain open across different periods until explicitly closed
            
            // Define an initial position size
            const initialSize = ethers.parseUnits("200", 6); // 200 MockUSDC
    
            // Trader1 opens a long position in period 0
            await openPosition(trader1, ethers.getNumber(initialSize), true);
    
            // Advance time to next period
            await ethers.provider.send("evm_increaseTime", [2592000]); 
            await ethers.provider.send("evm_mine", []);

            const positionLong = await dex.getTraderPositions(await trader1.getAddress(),true);
            const positionShort = await dex.getTraderPositions(await trader1.getAddress(),false); 

            expect(positionLong).to.equal(initialSize); // The position should not remain for the next period
            expect(positionShort).to.equal(0); // The position should not remain for the next period
        });        
    });

    // Rewarding chain calculations and period transitions
    describe("Reward Calculations and Period Transitions", function () {
        beforeEach(async () => {
            switchCoolDown(owner,0);
        });

        it("1- No reward calculation on first position open within a period", async function () {
            // Trader1 opens a position for the first time in the initial period
            await openPosition(trader1, 100, true); // Opening long position
            
            // Check claimable rewards for trader1 in the current period
            const rewards1 = await dex.claimableRewards(await trader1.getAddress(), await dex.getPeriod());
            expect(rewards1[0]).to.equal(false); // bool: false
            expect(rewards1[1]).to.equal(0); // uint256: 0
        });

        it("2- Reward calculation triggered by second position opening", async function () {
            // Trader1 opens a position for the first time
            await openPosition(trader1, 100, true);
            // Trader2 opens a position, triggering reward calculation for Trader1
            await openPosition(trader2, 100, false); // Assume this is still the same period

            // Check claimable rewards for trader1, should now be non-zero
            const rewards1 = await dex.claimableRewards(await trader1.getAddress(), await dex.getPeriod());
            expect(rewards1[0]).to.equal(false); // bool: false
            expect(rewards1[1]).to.be.above(0); // uint256: should be above zero
        });

        it("3- Subsequent actions modify claimable rewards", async function () {
            // Following the previous test, now trader3 opens a position
            await openPosition(trader3, 100, true); // New action, different from trader1 and trader2
            await openPosition(trader1, 100, true); 
            // Check updated claimable rewards for trader1 and trader2 in the current period
            const rewards1After = await dex.claimableRewards(await trader1.getAddress(), await dex.getPeriod());
            const rewards3After = await dex.claimableRewards(await trader3.getAddress(), await dex.getPeriod());

            // Rewards should be updated
            expect(rewards1After[1]).to.be.equal(0); // New reward for trader1
            expect(rewards3After[1]).to.be.above(0); // Initial reward for trader2
        });

        it("4- Rewards continue to increase with more actions", async function () {
            // Assume more actions taken here
            await openPosition(trader2, 200, false); // Additional actions
            await openPosition(trader3, 150, true);  // Additional actions
            
            // Check updated rewards; they should increase from their initial values
            const rewards2Final = await dex.claimableRewards(await trader2.getAddress(), await dex.getPeriod());
            const rewards3Final = await dex.claimableRewards(await trader3.getAddress(), await dex.getPeriod());
            expect(rewards2Final[1]).to.be.above(0); // Increased reward for trader1
            expect(rewards3Final[1]).to.be.equal(0); // trader3 remains
        });

        it("5- Rewards are separated and transitioned between periods", async function () {
            // Wait until next period
            await ethers.provider.send("evm_increaseTime", [2592000]);
            await ethers.provider.send("evm_mine", []);

            // Continue trading in the new period
            await openPosition(trader1, 100, true); // New period action
            await openPosition(trader2, 100, false); // New period action

            // Check rewards for new period
            const newPeriod = await dex.getPeriod();
            const rewards1NewPeriod = await dex.claimableRewards(await trader1.getAddress(), newPeriod);
            expect(rewards1NewPeriod[1]).to.be.above(0); // Rewards for new period start accumulating
        });
    });
    

    // Analyze and measure the gas consumption for key operations like opening and closing positions
    describe("Gas Consumption Mechanics", function () {
        beforeEach(async () => {
            switchCoolDown(owner,0);
        });

        // Assess gas usage for typical trading operations to ensure efficiency and cost-effectiveness
        it("should manage gas efficiently for trading operations", async function () {
            const expectedGasLimitForOpening = ethers.parseUnits("300000", "wei");
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