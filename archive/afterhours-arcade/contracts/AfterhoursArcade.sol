// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AfterhoursArcade
/// @notice Sells arcade quarters on Base. Purchases are recorded on-chain and
///         emitted for an off-chain arcade service to grant spendable credits.
/// @dev Deploy this contract on Base mainnet only. USDC is native Circle USDC
///      on Base and has six decimals. This contract does not verify game scores.
contract AfterhoursArcade {
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint256 public constant USDC_PER_QUARTER = 250_000;
    uint256 public constant MAX_QUARTERS_PER_PURCHASE = 100;

    address public owner;
    address public pendingOwner;
    address public treasury;
    uint256 public ethQuarterPriceWei;
    bool public paused;
    uint256 private unlocked = 1;

    mapping(address => uint256) public quartersPurchased;

    event QuarterPurchased(address indexed buyer, uint256 quarters, address indexed currency, uint256 amountPaid);
    event EthPriceChanged(uint256 oldPrice, uint256 newPrice);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event PauseChanged(bool paused);
    event OwnershipTransferStarted(address indexed oldOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event FundsWithdrawn(address indexed currency, address indexed treasury, uint256 amount);

    error NotOwner();
    error NotPendingOwner();
    error InvalidAddress();
    error InvalidQuarterCount();
    error WrongPayment();
    error SalesPaused();
    error ReentrantCall();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (unlocked != 1) revert ReentrantCall();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    modifier whenOpen() {
        if (paused) revert SalesPaused();
        _;
    }

    constructor(address treasury_, uint256 ethQuarterPriceWei_) {
        if (treasury_ == address(0)) revert InvalidAddress();
        owner = msg.sender;
        treasury = treasury_;
        ethQuarterPriceWei = ethQuarterPriceWei_;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function buyWithUSDC(uint256 count) external whenOpen nonReentrant {
        _validateCount(count);
        uint256 amount = USDC_PER_QUARTER * count;
        // USDC returns a bool. Calling through its interface also rejects a
        // reverted transfer. The exact amount reaches this contract.
        (bool ok, bytes memory data) = USDC.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        quartersPurchased[msg.sender] += count;
        emit QuarterPurchased(msg.sender, count, USDC, amount);
    }

    function buyWithETH(uint256 count) external payable whenOpen nonReentrant {
        _validateCount(count);
        if (ethQuarterPriceWei == 0 || msg.value != ethQuarterPriceWei * count) revert WrongPayment();
        quartersPurchased[msg.sender] += count;
        emit QuarterPurchased(msg.sender, count, address(0), msg.value);
    }

    function setEthQuarterPrice(uint256 newPriceWei) external onlyOwner {
        emit EthPriceChanged(ethQuarterPriceWei, newPriceWei);
        ethQuarterPriceWei = newPriceWei;
    }

    function setPaused(bool isPaused) external onlyOwner {
        paused = isPaused;
        emit PauseChanged(isPaused);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidAddress();
        emit TreasuryChanged(treasury, newTreasury);
        treasury = newTreasury;
    }

    function startOwnershipTransfer(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address oldOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, msg.sender);
    }

    function withdrawETH() external onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        (bool ok,) = treasury.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FundsWithdrawn(address(0), treasury, amount);
    }

    function withdrawUSDC() external onlyOwner nonReentrant {
        (bool readOk, bytes memory balanceData) = USDC.staticcall(
            abi.encodeWithSignature("balanceOf(address)", address(this))
        );
        if (!readOk || balanceData.length != 32) revert TransferFailed();
        uint256 amount = abi.decode(balanceData, (uint256));
        (bool ok, bytes memory data) = USDC.call(
            abi.encodeWithSignature("transfer(address,uint256)", treasury, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        emit FundsWithdrawn(USDC, treasury, amount);
    }

    function _validateCount(uint256 count) internal pure {
        if (count == 0 || count > MAX_QUARTERS_PER_PURCHASE) revert InvalidQuarterCount();
    }

    receive() external payable { revert WrongPayment(); }
}
