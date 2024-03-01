// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MockDerivativesDEX is ReentrancyGuard {
    event PositionOpened(address indexed trader, uint256 size, bool isLong);
    event PositionClosed(address indexed trader, uint256 size, bool isLong);
    event PositionCancelled(address indexed trader, uint256 size, bool isLong);

    struct Position {
        uint256 long;
        uint256 short;
    }

    IERC20 public mockUSDC;
    mapping(address => mapping(uint256 => Position)) public traderPositionsPerPeriod;
    mapping(address => uint256) public traderLongPositions;
    mapping(address => uint256) public traderShortPositions;
    mapping(uint256 => uint256) public totalLongPool;
    mapping(uint256 => uint256) public totalShortPool;
    mapping(address => mapping(uint256 => uint256)) public hasActiveParticipation;
    mapping(uint256 => uint256) public totalVolumePerPeriod;

    uint256 public startTimestamp;
    uint256 private constant DECIMALS = 1; // no scale
    uint256 private constant PERIOD_DURATION = 2592000;

    constructor(address _mockUSDCAddress) {
        startTimestamp = block.timestamp;
        mockUSDC = IERC20(_mockUSDCAddress);
    }

    function getPeriod() public view returns (uint256) {
        return (block.timestamp - startTimestamp) / PERIOD_DURATION;
    }

    function openPosition(uint256 sizeInUSDC, bool isLong) external {
        require(sizeInUSDC > 0, "Position size must be greater than zero");
        uint256 currentPeriod = getPeriod();
        uint256 size = sizeInUSDC * DECIMALS;

        mockUSDC.transferFrom(msg.sender, address(this), size);

        Position storage position = traderPositionsPerPeriod[msg.sender][currentPeriod];

        if (isLong) {
            position.long += size;
            traderLongPositions[msg.sender] += size;
            totalLongPool[currentPeriod] += size;
        } else {
            position.short += size;
            traderShortPositions[msg.sender] += size;
            totalShortPool[currentPeriod] += size;
        }

        totalVolumePerPeriod[currentPeriod] += size;
        hasActiveParticipation[msg.sender][currentPeriod]++;

        emit PositionOpened(msg.sender, size, isLong);
    }

    function closePosition(uint256 sizeInUSDC, bool isLong) external {
        require(sizeInUSDC > 0, "Position size must be greater than zero");
        uint256 currentPeriod = getPeriod();
        uint256 size = sizeInUSDC * DECIMALS;

        if (isLong) {
            require(traderLongPositions[msg.sender] >= size, "Insufficient long position");
            uint256 currentLong = traderPositionsPerPeriod[msg.sender][currentPeriod].long;
            uint256 newLongPosition = currentLong > size ? currentLong - size : 0;
            traderPositionsPerPeriod[msg.sender][currentPeriod].long = newLongPosition;
            traderLongPositions[msg.sender] -= size;
            totalLongPool[currentPeriod] = totalLongPool[currentPeriod] > size ? totalLongPool[currentPeriod] - size : 0;
        } else {
            require(traderShortPositions[msg.sender] >= size, "Insufficient short position");
            uint256 currentShort = traderPositionsPerPeriod[msg.sender][currentPeriod].short;
            uint256 newShortPosition = currentShort > size ? currentShort - size : 0;
            traderPositionsPerPeriod[msg.sender][currentPeriod].short = newShortPosition;
            traderShortPositions[msg.sender] -= size;
            totalShortPool[currentPeriod] = totalShortPool[currentPeriod] > size ? totalShortPool[currentPeriod] - size : 0;
        }

        mockUSDC.transfer(msg.sender, sizeInUSDC);

        totalVolumePerPeriod[currentPeriod] += size;
        
        hasActiveParticipation[msg.sender][currentPeriod]++;

        emit PositionClosed(msg.sender, size, isLong);
    }

    function withdrawFromPosition(uint256 sizeInUSDC, bool isLong) external nonReentrant {
        require(sizeInUSDC > 0, "Position size must be greater than zero");
        uint256 period = getPeriod();
        uint256 size = sizeInUSDC * DECIMALS;

        if (isLong) {
            require(traderLongPositions[msg.sender] >= size, "Insufficient long position");
            uint256 currentLong = traderPositionsPerPeriod[msg.sender][period].long;
            uint256 newLongPosition = currentLong > size ? currentLong - size : 0;
            traderPositionsPerPeriod[msg.sender][period].long = newLongPosition;
            traderLongPositions[msg.sender] -= size;
            totalLongPool[period] = totalLongPool[period] > size ? totalLongPool[period] - size : 0;
        } else {
            require(traderShortPositions[msg.sender] >= size, "Insufficient short position");
            uint256 currentShort = traderPositionsPerPeriod[msg.sender][period].short;
            uint256 newShortPosition = currentShort > size ? currentShort - size : 0;
            traderPositionsPerPeriod[msg.sender][period].short = newShortPosition;
            traderShortPositions[msg.sender] -= size;
            totalShortPool[period] = totalShortPool[period] > size ? totalShortPool[period] - size : 0;
        }

        mockUSDC.transfer(msg.sender, sizeInUSDC);

        if (hasActiveParticipation[msg.sender][period] > 0) {
            hasActiveParticipation[msg.sender][period]--;
        }

        emit PositionCancelled(msg.sender, size, isLong);
    }

    function getTraderPositions(address trader, bool isLong) external view returns(uint256){
        return isLong ? traderLongPositions[trader] : traderShortPositions[trader];
    }

    function getTraderActiveParticipation(address trader, uint256 period) external view returns(bool){
        return hasActiveParticipation[trader][period] % 2 == 0;
    }

    function getTraderPositionForPeriod(address trader, uint256 period, bool isLong) external view returns (uint256) {
        uint256 positionSize;
        
        if (isLong) {
            positionSize = traderPositionsPerPeriod[trader][period].long;
        } else {
            positionSize = traderPositionsPerPeriod[trader][period].short;
        }

        uint256 positionSizeInUSDC = positionSize / DECIMALS;
        return positionSizeInUSDC;
    }

    function getCumulativeMarketVolume(uint256 period) external view returns (uint256) {
        uint256 totalVolume = totalVolumePerPeriod[period];
        uint256 totalVolumeInUSDC = totalVolume / DECIMALS;
        return totalVolumeInUSDC;
    }
}
