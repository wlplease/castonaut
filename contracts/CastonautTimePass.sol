// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20TransferFrom {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Non-transferable, prepaid 30-day Castonaut access on Base.
/// @dev Deploy with the revenue wallet as treasury. There are no owner controls or renewals.
contract CastonautTimePass {
    IERC20TransferFrom public constant USDC = IERC20TransferFrom(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    uint256 public constant PRICE = 3_700_000; // 3.70 native USDC (6 decimals)
    uint64 public constant PASS_DURATION = 30 days;

    address public immutable treasury;
    mapping(address wallet => uint64 expiry) public expiresAt;

    event PassPurchased(address indexed wallet, uint64 expiresAt, uint256 amount);

    error InvalidTreasury();
    error PaymentFailed();
    error ExpiryOverflow();

    constructor(address treasury_) {
        if (treasury_ == address(0)) revert InvalidTreasury();
        treasury = treasury_;
    }

    /// @notice Pay 3.70 USDC for 30 days. An active pass extends from its current expiry.
    /// @dev The caller approves this contract for exactly PRICE before calling.
    function buyPass() external {
        if (!USDC.transferFrom(msg.sender, treasury, PRICE)) revert PaymentFailed();
        uint256 start = expiresAt[msg.sender] > block.timestamp ? expiresAt[msg.sender] : block.timestamp;
        uint256 nextExpiry = start + PASS_DURATION;
        if (nextExpiry > type(uint64).max) revert ExpiryOverflow();
        expiresAt[msg.sender] = uint64(nextExpiry);
        emit PassPurchased(msg.sender, uint64(nextExpiry), PRICE);
    }
}
