/** @author: denizumutdereli */

import { expect } from "chai";
import { ethers } from "hardhat";
import { MockDerivativesDEX, MockUSDC } from "../typechain-types";
import "@nomicfoundation/hardhat-toolbox";
import { Signer, toBigInt } from "ethers";

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
    const openPosition = async (trader: Signer, size: number, isLong: boolean) => {
        await dex.connect(trader).openPosition(size, isLong);
        const address = ((await trader.getAddress()).toLowerCase());
      
        const currentPeriod = await dex.getPeriod();
        const position = await dex.getTraderPositionForPeriod(address, currentPeriod, isLong);

        expect(ethers.toBigInt(position)).to.equal(ethers.toBigInt(size));
    };

    // Helper function to close a trading position on the DEX
    const closePosition = async (trader:Signer, size:number, isLong:boolean) => {
        await dex.connect(trader).closePosition(size, isLong);
        const currentPeriod = await dex.getPeriod();
        const position = await dex.getTraderPositionForPeriod(await trader.getAddress(), currentPeriod, isLong);
        const expectedPositionSize = position
        // Traders close positions with specified size and direction
        expect(expectedPositionSize).to.equal(0);
    };

    // Initial state test to ensure smart contracts are deployed correctly
    describe("Deployment and Initial State", function () {
        it("should correctly deploy with initial settings", async function () {
            // Confirm the MockUSDC contract address matches the address set in DEX contract
            expect(await dex.mockUSDC()).to.equal(await mockUSDC.getAddress());
        });
    });

    // Testing suite for trading mechanics of the DEX
    describe("Trading Mechanics", function () {
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

            // Withdraw from position with success and failure
            await expect(dex.connect(trader2).withdrawFromPosition(positionSize / BigInt(2), false))
                .to.emit(dex, "PositionCancelled");
            await expect(dex.connect(trader2).withdrawFromPosition(positionSize * BigInt(2), false))
                .to.be.revertedWith("Insufficient short position");
        });
    });

    // Test interactions among multiple users within the DEX environment
    describe("Multiple User Interactions", function () {
        it("allows multiple users to open and close positions within the same period", async function () {
            // Simulate multiple traders opening and closing positions and verify the state of the DEX thereafter
            const size = ethers.parseUnits("100", 6); // Örneğin 100 MockUSDC
    
            // Trader1 long pozisyon açar
            await openPosition(trader1, ethers.getNumber(size), true);
            // Trader2 short pozisyon açar
            await openPosition(trader2, ethers.getNumber(size), false);
    
            // Her iki kullanıcının da pozisyonlarını kapatması
            await closePosition(trader1, ethers.getNumber(size), true);
            await closePosition(trader2, ethers.getNumber(size), false);
    
            // Checking the pool
            const totalLong = await dex.totalLongPool(0);
            const totalShort = await dex.totalShortPool(0);
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
    
        it("ensures that withdrawals from positions are only allowed for past periods", async function () {
            // Confirm that traders can withdraw their positions from past periods without issues.
            const size = ethers.parseUnits("100", 6);
    
            await openPosition(trader1, ethers.getNumber(size), true);
    
            // Geçmiş dönem için çekme denemesi
            // Önce zamanı ileri alalım
            await ethers.provider.send("evm_increaseTime", [2592000]);
            await ethers.provider.send("evm_mine", []);
    
            expect(await dex.connect(trader1).withdrawFromPosition(size, true))
                .to.emit(dex, "PositionCancelled");
        });

        // Test suite for ensuring the continuity of positions across different trading periods
        describe("Position Continuity Across Periods", function() {
            it("should not allow manipulation of previous period different positions in future periods", async function() {
                // Test that positions remain open across different periods until explicitly closed
                const size = ethers.parseUnits("500", 6);
                await openPosition(trader1, ethers.getNumber(size), true); // Period 0 Long
                // Advance to next period
                await ethers.provider.send("evm_increaseTime", [2592000]);
                await ethers.provider.send("evm_mine", []);
                // Attempt to close position from previous period Short
                await expect(dex.connect(trader1).closePosition(ethers.getNumber(size), false)).to.be.revertedWith("Insufficient short position");
            });
        });
        
    });

    // Fuzzy testing for complex scenarios like fractional positions and time travel
    describe("Fuzzy testing: Fractional Position Handling and Time Advance Scenario", function () {
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

            await expect(dex.connect(trader3).withdrawFromPosition(sizeTrader3Open, true))
                .to.emit(dex, "PositionCancelled");
    
            // Re-open and close positions for Trader 1 and Trader 2 in the new period
            await openPosition(trader1, ethers.getNumber(sizeTrader2Open), false);
            await openPosition(trader2, ethers.getNumber(sizeTrader1Open), true);
            await closePosition(trader1, ethers.getNumber(sizeTrader2Open), false);
            await closePosition(trader2, ethers.getNumber(sizeTrader1Open), true);
    
            // Validate final balances and total market volume
            const finalTrader1Balance = await mockUSDC.balanceOf(await trader1.getAddress());
            const finalTrader2Balance = await mockUSDC.balanceOf(await trader2.getAddress());
            const finalTrader3Balance = await mockUSDC.balanceOf(await trader3.getAddress());
    
            // Validate expected balances considering all transactions
            const expectedBalanceTrader1 = initialSupply;
            const expectedBalanceTrader2 = initialSupply;
            const expectedBalanceTrader3 = initialSupply; // Since Trader 3 withdrew their initial open position and didn't open a new one
    
            expect(finalTrader1Balance).to.equal(expectedBalanceTrader1);
            expect(finalTrader2Balance).to.equal(expectedBalanceTrader2);
            expect(finalTrader3Balance).to.equal(expectedBalanceTrader3);
    
            // Validate total market volume across periods
            const finalTotalVolume = await dex.totalVolumePerPeriod(await dex.getPeriod());
            const expectedTotalVolume = (sizeTrader1Open + sizeTrader2Open) * toBigInt(2); // Count each transaction twice
    
            expect(finalTotalVolume).to.equal(expectedTotalVolume);
        });
    });

    // Test suite for ensuring the continuity of positions across different trading periods
    describe("Position Continuity Across Periods", function () {
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
    
        it("should allow withdrawal from past periods correctly", async function () {
            // Confirm that traders can withdraw their positions from past periods without issues
            
            // Trader opens a position within the first period
            const positionSize = ethers.parseUnits("300", 6); // 300 MockUSDC
            await openPosition(trader2, Number(positionSize), false); // Open a short position
        
            // Advance time to the next period
            await ethers.provider.send("evm_increaseTime", [2592000]);
            await ethers.provider.send("evm_mine", []);
        
            const currentPeriod = await dex.getPeriod();
            const previousPeriod = currentPeriod - BigInt(1);
        
            // Ensure the trader's position is as expected before the withdrawal
            const initialPosition = await dex.traderShortPositions(await trader2.getAddress());
            expect(initialPosition).to.equal(Number(positionSize));
        
            // Attempt withdrawal from the previous period
            const withdrawTx = await dex.connect(trader2).withdrawFromPosition(Number(positionSize), false);
            await expect(withdrawTx).to.emit(dex, "PositionCancelled");
        
            // Verify no positions remain after withdrawal for the specific period
            const remainingPositionPeriod = await dex.traderShortPositions(await trader2.getAddress());
            expect(remainingPositionPeriod).to.equal(0);
        
            // Verify the overall positions reflect the withdrawal correctly
            const remainingTotalPosition = await dex.getTraderPositions(await trader2.getAddress(), false);
            expect(remainingTotalPosition).to.equal(0);
        });
        
    });

    // Analyze and measure the gas consumption for key operations like opening and closing positions
    describe("Gas Consumption Mechanics", function () {
        // Assess gas usage for typical trading operations to ensure efficiency and cost-effectiveness
        it("should manage gas efficiently for trading operations", async function () {
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