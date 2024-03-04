// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IMockDerivativesDEX {
    function getPeriod() external view returns (uint256);
    function claimableRewards(address _trader, uint256 _period) external view returns(bool, uint256);
    function confirmClaim(address _trader, uint256 _period) external returns(bool);
    function getTraderActiveParticipation(uint256 period,address trader) external view returns(bool);
}

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

contract RewardSystem is ReentrancyGuard, AccessControl, Pausable {
    using SafeERC20 for IERC20;
    using AddressUtils for address;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    IERC20 public rewardToken;
    IMockDerivativesDEX public derivativesDEX;

    uint256 public COOLDOWN_PERIOD = 10;
    uint256 public MIN_CLAIMABLE_AMOUNT = 1 * 1e6;

    mapping(address => bool) public excludedAddresses;
    mapping(address => uint256) public lastActionTime;

    event RewardClaimed(address indexed trader, uint256 reward);
    event DEXAddressUpdated(address newDEXAddress);
    event RewardTokenAddressUpdated(address newRewardTokenAddress);
    event AddressExcluded(address indexed addr);
    event AddressIncluded(address indexed addr);
    event TokensWithdrawn(address token, address to, uint256 amount);
    event CoolDownPeriodUpdated(uint256 _newCoolDownPeriod);
    
    error UnableToUpdateRewardReset();
    error UnableToTransferRewards();
    
    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, _msgSender()),"Ownable: caller is not the owner");
        _;
    }

   modifier validAddress(address _addr){
        require(AddressUtils.isAddress(_addr), "Invalid address");
        _;
    }
    
    modifier notExcluded() {
        require(!excludedAddresses[_msgSender()], "Address is excluded from rewards");
        _;
    }

    modifier coolDown(){
        require(block.timestamp - lastActionTime[_msgSender()] >= COOLDOWN_PERIOD, "Cooldown period has not elapsed");
        _;
    }

    constructor(address _rewardTokenAddress, address _derivativesDEXAddress) {
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());
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

    function claimRewards(uint256 period) external whenNotPaused notExcluded nonReentrant {
        require(period < derivativesDEX.getPeriod(), "Cannot claim for ongoing or future periods");
        require(derivativesDEX.getTraderActiveParticipation(period, _msgSender()), "Not participated and not eligible for rewards");

        (bool previousClaim, uint256 claimableRewards) = derivativesDEX.claimableRewards(_msgSender(), period);
        require(!previousClaim, "Previously claimed for this period");
        require(claimableRewards > 0, "No Rewards to claim");
        require(claimableRewards >= MIN_CLAIMABLE_AMOUNT, "Reward below minimum claim amount");

        bool success = _transferReward(claimableRewards, _msgSender());
        require(success, "Unable to transfer rewards");

        bool confirmed = derivativesDEX.confirmClaim(_msgSender(), period);
        require(confirmed, "Unable to update reward reset");

        lastActionTime[_msgSender()] = block.timestamp;

        emit RewardClaimed(_msgSender(), claimableRewards);
    }

    function _transferReward(uint256 reward, address trader) private returns(bool) {
        require(reward >= MIN_CLAIMABLE_AMOUNT, "Reward below minimum claim amount");
        uint256 rewardTokenBalance = rewardToken.balanceOf(address(this));
        require(reward <= rewardTokenBalance, "Insufficient reward tokens");
        rewardToken.safeTransfer(trader, reward);
        return true;
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

    function balance() external view returns(uint256){
        return rewardToken.balanceOf(address(this));
    }

    function rescueTokens(address tokenAddress, address to, uint256 amount) external validAddress(tokenAddress) onlyAdmin {
        require(tokenAddress != address(rewardToken), "Cannot clear tokens");
        IERC20(tokenAddress).safeTransfer(to, amount);
        emit TokensWithdrawn(tokenAddress, to, amount);
    }
    
    function _setRewardTokenAddress(address _addr) private {
        rewardToken = IERC20(_addr);
        emit RewardTokenAddressUpdated(_addr);
    }

    function _setDEXAddress(address _addr) private {
        derivativesDEX = IMockDerivativesDEX(_addr);
        emit DEXAddressUpdated(_addr);
    }

    function updateCoolDownPeriod(uint256 _newPeriod) external onlyAdmin {
        COOLDOWN_PERIOD = _newPeriod;
        emit CoolDownPeriodUpdated(COOLDOWN_PERIOD);
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