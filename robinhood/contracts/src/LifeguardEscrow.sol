// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// @title Lifeguard: an undo button for payments on Robinhood Chain.
/// @notice A payment is held here for an undo window. Until the window ends the payer (or, if one was named,
///         only the arbiter) can undo it and get all of it back; the recipient can refuse it at any time before
///         it is released. After the window anyone can release it to the recipient, and the payer can release
///         it early. No owner, no fees, no upgrades: nobody but the parties to a payment can move its money.
contract LifeguardEscrow {
    enum Status { None, Pending, Released, Undone, Refused }

    struct Payment {
        address payer;
        address recipient;
        address token;      // address(0) for ETH
        address arbiter;    // address(0) if none
        uint128 amount;
        uint64 releaseAt;   // end of the undo window
        Status status;
    }

    uint64 public constant MIN_WINDOW = 5 minutes;
    uint64 public constant MAX_WINDOW = 30 days;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    Payment[] private _payments;
    mapping(address => uint256[]) private _byPayer;
    mapping(address => uint256[]) private _byRecipient;
    uint256 private _lock = 1;

    event Sent(uint256 indexed id, address indexed payer, address indexed recipient, address token, uint256 amount,
               uint64 releaseAt, address arbiter);
    event Undone(uint256 indexed id, address by);
    event Refused(uint256 indexed id);
    event Released(uint256 indexed id, address by);

    error BadRecipient();
    error BadAmount();
    error BadWindow();
    error NotPending();
    error NotAllowed();
    error TooEarly();
    error TooLate();
    error TransferFailed();
    error Reentrant();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrant();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @notice Pay `recipient` with an undo window of `window` seconds. For ETH pass token = address(0) and send
    ///         the amount as msg.value; for a token, approve this contract first.
    function send(address token, address recipient, uint256 amount, uint64 window, address arbiter)
        external payable nonReentrant returns (uint256 id)
    {
        if (recipient == address(0) || recipient == DEAD || recipient == address(this) || recipient == msg.sender
            || (token != address(0) && recipient == token)) revert BadRecipient();
        if (window < MIN_WINDOW || window > MAX_WINDOW) revert BadWindow();
        if (arbiter == recipient) revert NotAllowed();

        uint256 received;
        if (token == address(0)) {
            if (msg.value == 0 || msg.value != amount) revert BadAmount();
            received = msg.value;
        } else {
            if (msg.value != 0 || amount == 0) revert BadAmount();
            if (token.code.length == 0) revert TransferFailed(); // not a token contract
            // Count what actually arrived, so fee-on-transfer tokens can never pay out more than they hold.
            uint256 before = IERC20(token).balanceOf(address(this));
            _call(token, abi.encodeCall(IERC20.transferFrom, (msg.sender, address(this), amount)));
            received = IERC20(token).balanceOf(address(this)) - before;
            if (received == 0) revert BadAmount();
        }
        if (received > type(uint128).max) revert BadAmount();

        id = _payments.length;
        uint64 releaseAt = uint64(block.timestamp) + window;
        _payments.push(Payment(msg.sender, recipient, token, arbiter, uint128(received), releaseAt, Status.Pending));
        _byPayer[msg.sender].push(id);
        _byRecipient[recipient].push(id);
        emit Sent(id, msg.sender, recipient, token, received, releaseAt, arbiter);
    }

    /// @notice Cancel a payment before its window ends; all of it goes back to the payer.
    ///         With an arbiter, only the arbiter can undo, so the payer can't claw back finished work alone.
    function undo(uint256 id) external nonReentrant {
        Payment storage p = _pending(id);
        if (block.timestamp >= p.releaseAt) revert TooLate();
        if (msg.sender != (p.arbiter == address(0) ? p.payer : p.arbiter)) revert NotAllowed();
        p.status = Status.Undone;
        emit Undone(id, msg.sender);
        _pay(p.token, p.payer, p.amount);
    }

    /// @notice The recipient turns a payment down (wrong person, not expected); it goes back to the payer.
    function refuse(uint256 id) external nonReentrant {
        Payment storage p = _pending(id);
        if (msg.sender != p.recipient) revert NotAllowed();
        p.status = Status.Refused;
        emit Refused(id);
        _pay(p.token, p.payer, p.amount);
    }

    /// @notice Deliver a payment to its recipient: anyone once the window has ended; the payer or arbiter any time.
    function release(uint256 id) external nonReentrant {
        Payment storage p = _pending(id);
        if (block.timestamp < p.releaseAt && msg.sender != p.payer && msg.sender != p.arbiter) revert TooEarly();
        p.status = Status.Released;
        emit Released(id, msg.sender);
        _pay(p.token, p.recipient, p.amount);
    }

    function payment(uint256 id) external view returns (Payment memory) {
        return _payments[id];
    }

    function count() external view returns (uint256) {
        return _payments.length;
    }

    function paymentsOf(address who) external view returns (uint256[] memory sent, uint256[] memory received) {
        return (_byPayer[who], _byRecipient[who]);
    }

    function _pending(uint256 id) private view returns (Payment storage p) {
        if (id >= _payments.length) revert NotPending();
        p = _payments[id];
        if (p.status != Status.Pending) revert NotPending();
    }

    function _pay(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            _call(token, abi.encodeCall(IERC20.transfer, (to, amount)));
        }
    }

    /// Works with tokens that return nothing (USDT-style) as well as those that return a bool.
    function _call(address token, bytes memory data) private {
        if (token.code.length == 0) revert TransferFailed();
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
