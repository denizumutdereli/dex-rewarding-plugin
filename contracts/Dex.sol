// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

library AddressUtils {
    function isAddress(address _addr) internal view returns (bool) {
        require(_addr != address(0), "Address cannot be zero");
        uint32 size;
        assembly {
            size := extcodesize(_addr)
        }
        return (size > 0);
    }
}

contract MockDerivativesDEX is ReentrancyGuard, AccessControl, Pausable {
    using SafeERC20 for IERC20;
    using AddressUtils for address;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant REWARD_PLUGIN_ROLE = keccak256("REWARD_PLUGIN_ROLE");
    
    event PositionOpened(address indexed trader, uint256 size, bool isLong);
    event PositionClosed(address indexed trader, uint256 size, bool isLong);
    event PositionCancelled(address indexed trader, uint256 size, bool isLong);
    event RewardRateUpdated(uint256 newRewardRate);
    event USDCAddressUpdated(address newUSDCAddress);
    event PreviousUSDCAddrBalanceTransferred(address _walletToTransferCurrentUSDCTokens, uint256 currentBalance);
    event USDCTokensWithdrawn(address token, address to, uint256 amount);
    event CoolDownPeriodUpdated(uint256 _newCoolDownPeriod);

    struct Position {
        uint256 long;
        uint256 short;
    }

    struct TraderPositions {
        uint256 timestamp;
        uint256 reward;
        uint256 sizeInUSDC;
    }

    struct TraderRewards {
        uint256 reward;
        bool claimed;
    }

    IERC20 public USDCToken;
    address public rewardPluginContract;

    mapping(address => mapping(uint256 => Position)) public traderPositionsPerPeriod;
    mapping(address => uint256) public traderLongPositions;
    mapping(address => uint256) public traderShortPositions;
    mapping(uint256 => uint256) public totalLongPool;
    mapping(uint256 => uint256) public totalShortPool;
    mapping(address => mapping(uint256 => uint256)) public hasActiveParticipation;
    mapping(uint256 => uint256) public totalVolumePerPeriod;
    mapping(uint256 => address) public previousTraderPerPeriod;
    mapping(uint256 => mapping(address => TraderPositions)) public userPositions;
    mapping(uint256 => mapping(address => TraderRewards)) public traderRewards;
    mapping(address => uint256) public lastActionTime;

    uint256 public startTimestamp;
    uint256 public lastUpdatedPeriod;
    uint256 private constant PERIOD_DURATION = 180;
    uint256 private constant DECIMALS = 1; // no scale
    uint256 public REWARD_RATE = 387e6; // no precision provided, Im skipping for simplicity but the logic is same.
    uint256 public COOLDOWN_PERIOD = 10;

    modifier resetPeriodAndTakeASnapshotIfRequired() {
            uint256 currentPeriod = getPeriod();
            if (currentPeriod != lastUpdatedPeriod) {
                // Finalize rewards for the last trader of the old period
                if (previousTraderPerPeriod[lastUpdatedPeriod] != address(0)) {
                    updatePreviousTraderReward(lastUpdatedPeriod, previousTraderPerPeriod[lastUpdatedPeriod]);                    
                }
            
                // Update the current period state variable
                lastUpdatedPeriod = currentPeriod;
                // Additional data reset or archival steps could be performed here
            }
        _;
    }

    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, _msgSender()),"Ownable: caller is not the owner");
        _;
    }

    modifier onlyRewardingPlugin() {
        require(hasRole(REWARD_PLUGIN_ROLE, _msgSender()),"Ownable: caller is not the rewarding plugin");
        _;
    }

   modifier validAddress(address _addr){
        require(AddressUtils.isAddress(_addr), "Invalid address");
        _;
    }

    modifier coolDown(){
        require(block.timestamp - lastActionTime[_msgSender()] >= COOLDOWN_PERIOD, "Cooldown period has not elapsed");
        _;
    }

    constructor(IERC20 _USDCTokenAddress) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());

        startTimestamp = block.timestamp;
        USDCToken = IERC20(_USDCTokenAddress);
    }

    /* trading mechanics-------------------------------------------------------------------------------- */

    function openPosition(uint256 sizeInUSDC, bool isLong) external whenNotPaused resetPeriodAndTakeASnapshotIfRequired() coolDown() nonReentrant {
        require(sizeInUSDC > 0, "Position size must be greater than zero");
        uint256 currentPeriod = getPeriod();
        uint256 size = sizeInUSDC * DECIMALS;

        USDCToken.safeTransferFrom(_msgSender(), address(this), size);

        Position storage position = traderPositionsPerPeriod[_msgSender()][currentPeriod];

        if (isLong) {
            position.long += size;
            traderLongPositions[_msgSender()] += size;
            totalLongPool[currentPeriod] += size;
        } else {
            position.short += size;
            traderShortPositions[_msgSender()] += size;
            totalShortPool[currentPeriod] += size;
        }

        totalVolumePerPeriod[currentPeriod] += size;
        hasActiveParticipation[_msgSender()][currentPeriod]++;

        // Update the new position in the rewards system
        openNewPosition(currentPeriod, sizeInUSDC);
        lastActionTime[_msgSender()] = block.timestamp; // coolDown
        emit PositionOpened(_msgSender(), size, isLong);
    }

    function closePosition(uint256 sizeInUSDC, bool isLong) external whenNotPaused resetPeriodAndTakeASnapshotIfRequired() coolDown() nonReentrant {
        require(sizeInUSDC > 0, "Position size must be greater than zero");
        uint256 currentPeriod = getPeriod();
        uint256 size = sizeInUSDC * DECIMALS;

        if (isLong) {
            require(traderLongPositions[_msgSender()] >= size, "Insufficient long position");
            uint256 currentLong = traderPositionsPerPeriod[_msgSender()][currentPeriod].long;
            uint256 newLongPosition = currentLong > size ? currentLong - size : 0;
            traderPositionsPerPeriod[_msgSender()][currentPeriod].long = newLongPosition;
            traderLongPositions[_msgSender()] -= size;
            totalLongPool[currentPeriod] = totalLongPool[currentPeriod] > size ? totalLongPool[currentPeriod] - size : 0;
        } else {
            require(traderShortPositions[_msgSender()] >= size, "Insufficient short position");
            uint256 currentShort = traderPositionsPerPeriod[_msgSender()][currentPeriod].short;
            uint256 newShortPosition = currentShort > size ? currentShort - size : 0;
            traderPositionsPerPeriod[_msgSender()][currentPeriod].short = newShortPosition;
            traderShortPositions[_msgSender()] -= size;
            totalShortPool[currentPeriod] = totalShortPool[currentPeriod] > size ? totalShortPool[currentPeriod] - size : 0;
        }

        USDCToken.safeTransfer(_msgSender(), sizeInUSDC);

        totalVolumePerPeriod[currentPeriod] += size;
        
        hasActiveParticipation[_msgSender()][currentPeriod]++;

        openNewPosition(currentPeriod, sizeInUSDC);

        emit PositionClosed(_msgSender(), size, isLong);
    }

    /* reward claiming plugin interaction -----------------------------------------------------------*/

    function claimableRewards(address _trader, uint256 _period) external view whenNotPaused returns(bool, uint256)  {
        (bool ok, uint256 reward) = (traderRewards[_period][_trader].claimed ? true: false, traderRewards[_period][_trader].reward);
        return(ok, reward * 1e12); //scale up to 10 **18 same as erc20 / no precision clarified, so skipping with mock 
    }

    function confirmClaim(address _trader, uint256 _period) external onlyRewardingPlugin() whenNotPaused returns(bool) {        
        require(_period < getPeriod(), "Cannot claim for ongoing or future periods");
        TraderRewards storage _traderRewards = traderRewards[_period][_trader];
        uint256 actionCount = hasActiveParticipation[_trader][_period];

        // I'm keeping simple for demonstration, just confirming even number of actions
        require(actionCount >=2, "Not participated and not eligible for rewards");

        if(_traderRewards.claimed){
            return false;
        }
        
        if(_traderRewards.reward == 0) {
            return false;
        } 
        
        _traderRewards.reward = 0;
        _traderRewards.claimed = true;
        return true;
    }

    /* internals -------------------------------------------------------------------------------------*/

    function openNewPosition(uint256 period, uint256 sizeInUSDC) internal {
        if(previousTraderPerPeriod[period] != address(0)) {
            updatePreviousTraderReward(period, previousTraderPerPeriod[period]);
        }

        createPositionTimestamps(period);
        trackPositionTimestamps(period, sizeInUSDC);
        previousTraderPerPeriod[period] = _msgSender();
    }

    function updatePreviousTraderReward(uint256 period, address previousTrader) internal {
        TraderPositions storage previousRewards = userPositions[period][previousTrader];

        uint256 timeDiff = block.timestamp - previousRewards.timestamp;
        uint256 previousSizeInUSDC = previousRewards.sizeInUSDC;
        uint256 totalVolume = totalVolumePerPeriod[period];

        if (timeDiff > 0 && totalVolume > 0) {
            uint256 reward = REWARD_RATE * timeDiff * previousSizeInUSDC / totalVolume;
            traderRewards[period][previousTrader].reward += reward;

        previousRewards.timestamp = block.timestamp;
        }
    }

    function createPositionTimestamps(uint256 period) internal {
        TraderPositions storage rewards = userPositions[period][_msgSender()];
        if (rewards.timestamp == 0) {
            rewards.timestamp = block.timestamp;
            rewards.sizeInUSDC = 0;
        }
    }
    
    function trackPositionTimestamps(uint256 period, uint256 sizeInUSDC) internal {
        TraderPositions storage rewards = userPositions[period][_msgSender()];
        rewards.sizeInUSDC += sizeInUSDC;
    }

    /* getters------------------------------------------------------------------------------------------ */
    
    function getPeriod() public view returns (uint256) {
        return (block.timestamp - startTimestamp) / PERIOD_DURATION;
    }

    function getTraderPositions(address trader, bool isLong) external view returns(uint256){
        return isLong ? traderLongPositions[trader] : traderShortPositions[trader];
    }

    function getTraderActiveParticipation(uint256 period, address trader) external view returns(bool){
        return hasActiveParticipation[trader][period] >=2;
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

    /* administration & setters------------------------------------------------------------------------- */
    
    function rescueTokens(address tokenAddress, address to, uint256 amount) external validAddress(tokenAddress) onlyAdmin {
        require(tokenAddress != address(USDCToken), "Cannot clear tokens");
        USDCToken.safeTransfer(to, amount);
        emit USDCTokensWithdrawn(tokenAddress, to, amount);
    }

    function updateCoolDownPeriod(uint256 _newPeriod) external onlyAdmin {
        COOLDOWN_PERIOD = _newPeriod;
        emit CoolDownPeriodUpdated(COOLDOWN_PERIOD);
    }

    function setRewardRate(uint256 _rewardRate) external onlyAdmin {
        require(_rewardRate > 0, "reward rate can not be zero");
        REWARD_RATE = _rewardRate;
        emit RewardRateUpdated(_rewardRate);
    }

    function setRewardingPluginAddress(address _newAddr) external onlyAdmin validAddress(_newAddr)  {
        _revokeRole(REWARD_PLUGIN_ROLE, address(rewardPluginContract));
        _grantRole(REWARD_PLUGIN_ROLE, address(_newAddr));
    }

    function setUSDCAddress(IERC20 _addr, address _newAddr) external onlyAdmin validAddress(address(_newAddr)) {
        uint256 currentBalance = USDCToken.balanceOf(address(this));
        USDCToken.safeTransfer(_newAddr, currentBalance);
        USDCToken = IERC20(_addr);
        emit USDCAddressUpdated(address(_addr));
        emit PreviousUSDCAddrBalanceTransferred(_newAddr, currentBalance);
    }
   
    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }
    
    fallback() external {
        revert("Contract does not accept Ether");
    }

    receive() external payable {
        revert("Contract does not accept Ether");
    }
}