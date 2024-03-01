// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract MockERC20 is ERC20, ERC20Burnable {
    constructor() ERC20("Mock ERC20", "ERC") {
        _mint(msg.sender, 5000000 * 10 ** decimals()); 
    }

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

}
