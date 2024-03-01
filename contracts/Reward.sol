// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IMockDerivativesDEX {
    function getTraderPositionForPeriod(address trader, uint256 period, bool isLong) external view returns (uint256);
    function getCumulativeMarketVolume(uint256 period) external view returns (uint256);
    function getPeriod() external view returns (uint256);
    function getTimeElapsed() external view returns(uint256);
    function getTraderActiveParticipation(address trader, uint256 period) external view returns (bool);
}

library AddressUtils {
    function isAddress(address account) internal pure returns (bool) {
        return account != address(0);
    }
}

contract RewardSystem is ReentrancyGuard, AccessControl, Pausable {
    using SafeERC20 for IERC20;
    using AddressUtils for address;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    IERC20 public rewardToken;
    IMockDerivativesDEX public derivativesDEX;

    uint256 rewardRate = 387e15; 
    uint256 private constant PERIOD_DURATION = 2592000;
    uint256 public minRewardAmount = 0.01e16;
    bool public rateConfirm = false;
    bool public tokenConfirm = false;
    bool public dexConfirm = false;

    mapping(address => bool) public excludedAddresses;
    mapping(address => mapping(uint256 => bool)) public hasClaimedForPeriod;

    event RewardClaimed(address indexed trader, uint256 reward);
    event RewardRateUpdated(uint256 newRewardRate);
    event DEXAddressUpdated(address newDEXAddress);
    event RewardTokenAddressUpdated(address newRewardTokenAddress);
    event AddressExcluded(address indexed addr);
    event AddressIncluded(address indexed addr);
    event TokensWithdrawn(address token, address to, uint256 amount);

    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender),"Ownable: caller is not the owner");
        _;
    }

   modifier validAddress(address _addr){
        require(AddressUtils.isAddress(_addr), "Invalid address");
        _;
    }
    
    modifier notExcluded() {
        require(!excludedAddresses[msg.sender], "Address is excluded from rewards");
        _;
    }

    modifier concludedPeriod(uint256 period){
        require(block.timestamp > (period * PERIOD_DURATION) + PERIOD_DURATION, "Period is not yet concluded");
        uint256 currentPeriod = derivativesDEX.getPeriod();
        require(period < currentPeriod, "Cannot claim for future periods");
        _;
    }

    constructor(address _rewardTokenAddress, address _derivativesDEXAddress) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _setRewardTokenAddress(_rewardTokenAddress);
        _setDEXAddress(_derivativesDEXAddress);
    }

    function excludeAddress(address _addr) external validAddress(_addr) onlyAdmin {
        excludedAddresses[_addr] = true;
        emit AddressExcluded(_addr);
    }

    function includeAddress(address _addr) external validAddress(_addr) onlyAdmin {
        excludedAddresses[_addr] = false;
        emit AddressIncluded(_addr);
    }

    function claimRewards(uint256 period) external whenNotPaused notExcluded concludedPeriod(period) nonReentrant {
        require(!hasClaimedForPeriod[msg.sender][period], "Rewards already claimed for this period");
        uint256 reward = _calculateReward(period, msg.sender);
        require(reward >= minRewardAmount, "Reward below minimum claim amount");

        uint256 rewardTokenBalance = rewardToken.balanceOf(address(this));
        require(reward <= rewardTokenBalance, "Insufficient reward tokens");

        rewardToken.safeTransfer(msg.sender, reward);
        
        hasClaimedForPeriod[msg.sender][period] = true;

        emit RewardClaimed(msg.sender, reward);
    }

    function _calculateReward(uint256 period, address trader) private view returns (uint256) {
        
        bool participation =  derivativesDEX.getTraderActiveParticipation(msg.sender, period);

        if(!participation) revert("Trader not participated in this period");

        uint256 traderTotalVolume = _getTraderTotalVolumeForPeriod(trader, period);
        uint256 marketVolume = derivativesDEX.getCumulativeMarketVolume(period);
        
        if(marketVolume==0) return 0;

        uint256 traderShare = (traderTotalVolume * 1e18) / marketVolume;
        uint256 reward = (traderShare * rewardRate) / 1e18;

        return reward;
    }

    function _getTraderTotalVolumeForPeriod(address trader, uint256 period) private view returns (uint256) {
        uint256 traderLongVolume = derivativesDEX.getTraderPositionForPeriod(trader, period, true);
        uint256 traderShortVolume = derivativesDEX.getTraderPositionForPeriod(trader, period, false);
        return traderLongVolume + traderShortVolume;
    }

    function _transferReward(uint256 reward, address trader) private {
        require(reward >= minRewardAmount, "Reward below minimum claim amount");
        uint256 rewardTokenBalance = rewardToken.balanceOf(address(this));
        require(reward <= rewardTokenBalance, "Insufficient reward tokens");

        rewardToken.safeTransfer(trader, reward);
        emit RewardClaimed(trader, reward);
    }

    
    function clearDust(address _addr, address to, uint256 amount) external validAddress(_addr) onlyAdmin {
        require(_addr != address(rewardToken), "Cannot clear reward token");
        IERC20(_addr).safeTransfer(to, amount);
    }
    
    function withdrawRewardTokens(address to, uint256 amount) external whenPaused validAddress(to) onlyAdmin {
        require(amount > 0, "Invalid amount");
        uint256 rewardTokenBalance = rewardToken.balanceOf(address(this));
        require(amount <= rewardTokenBalance, "Insufficient reward tokens");

        rewardToken.safeTransfer(to, amount);
        emit TokensWithdrawn(address(rewardToken), to, amount);
    }

    function rescueTokens(address tokenAddress, address to, uint256 amount) external validAddress(tokenAddress) onlyAdmin {
        require(tokenAddress != address(rewardToken), "Cannot clear tokens");
        IERC20(tokenAddress).safeTransfer(to, amount);
        emit TokensWithdrawn(tokenAddress, to, amount);
    }

    function _setRewardRate(uint256 _rewardRate) private {
        rewardRate = _rewardRate;
        rateConfirm = false;
        emit RewardRateUpdated(_rewardRate);
    }

    function _setRewardTokenAddress(address _addr) private {
        rewardToken = IERC20(_addr);
        tokenConfirm = false;
        emit RewardTokenAddressUpdated(_addr);
    }

    function _setDEXAddress(address _addr) private {
        derivativesDEX = IMockDerivativesDEX(_addr);
        dexConfirm = false;
        emit DEXAddressUpdated(_addr);
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