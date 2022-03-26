// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Treasury is AccessControl {
    using SafeERC20 for IERC20;

    struct Investment {
        uint64 start_timestamp;
        uint64 end_timestamp;
        uint256 funding_goal;
        uint256 invested;
        address currency_address;
        bool unlocked_for_all;
        bool cancelled;
        bool cashed_out;
        string name;
        IERC20 payout_token_address;
        uint256 payout_token_amount;
        uint256[] allocations;
    }

    struct Allocation {
        uint256 initial_size;
        uint256 final_size;
        bool reward_paid;
    }

    Investment[] public investments;
    Allocation[] public allocations;
    mapping(uint256 => mapping(address => uint256)) allocations_for_address;

    event InvestmentCreated(string name, uint256 _investment, address _currency_address, uint64 _start_timestamp, uint64 _end_timestamp, uint256 _funding_goal);
    event FundsSent(uint256 _investment, address _investor, uint256 _final_size);
    event InvestmentUnlockedForAll(uint256 _investment, uint256 _new_end_timestamp);

    event AllocationCreated(uint256 _investment, address _investor, uint256 _initial_size);

    event FundsWithdrawn(uint256 _investment, uint256 _invested);
    event TokensDistributed(uint256 _investment, IERC20 _payout_token_address, uint256 _payout_token_amount);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        Allocation memory allocation = Allocation(0, 0, false);
        allocations.push(allocation);
    }

    function get_all_investments() external view returns (Investment[] memory) {
        return investments;
    }

    /*
     * Is allowed even for historical creation (start/end in the past)
    */
    function create_investment(string calldata _name, address _currency_address, uint64 _start_timestamp, uint64 _end_timestamp, uint256 _funding_goal) external onlyRole(DEFAULT_ADMIN_ROLE){
        require(_start_timestamp < _end_timestamp, "must start before it ends");
        Investment memory investment;
        investment.name = _name;
        investment.currency_address = _currency_address;
        investment.start_timestamp = _start_timestamp;
        investment.end_timestamp = _end_timestamp;
        investment.funding_goal = _funding_goal;
        uint256 investment_id = investments.length;
        investments.push(investment);
        emit InvestmentCreated(_name, investment_id, _currency_address, _start_timestamp, _end_timestamp, _funding_goal);
    }

    /*
     * Possible only before the funding period.
    */
    function create_allocation(uint256 _investment, address _investor_address, uint256 _initial_size) external onlyRole(DEFAULT_ADMIN_ROLE){
        Investment memory investment = investments[_investment];
        require(investment.start_timestamp > block.timestamp, "Funding period started");
        require(_initial_size > 0);
        uint256 alloc_id = allocations_for_address[_investment][_investor_address];
        require(alloc_id == 0, "Already has an allocation");
        Allocation memory allocation = Allocation(_initial_size, 0, false);
        alloc_id = allocations.length;
        allocations.push(allocation);
        allocations_for_address[_investment][_investor_address] = alloc_id;
        emit AllocationCreated(_investment, _investor_address, _initial_size);
    }

    /*
     * Only within allowed Allocations but if "unlock_investment_for_all" has been triggered, exceeding an allocation
     is allowed and new Allocations are created for new investors.
    */
    function fund_investment(uint256 _investment, uint256 amount) external payable {
        Investment storage investment = investments[_investment];
        require(investment.start_timestamp <= block.timestamp && investment.end_timestamp >= block.timestamp, "Not within funding period");
        uint256 alloc_id = allocations_for_address[_investment][msg.sender];
        uint256 available_size;

        if (investment.unlocked_for_all) {
            available_size = investment.funding_goal - investment.invested;
        }
        else {
            require(alloc_id != 0, "No allocation for this address");
            Allocation memory allocation_temp = allocations[alloc_id];
            available_size = allocation_temp.initial_size - allocation_temp.final_size;
        }

        uint256 value;
        if (investment.currency_address != address(0)) {
            require(msg.value == 0);
            value = amount;
            require(value <= available_size, "Can't exceed remaining allocation");
            IERC20 token = IERC20(investment.currency_address);
            token.safeTransferFrom(msg.sender, address(this), value);
        }
        else {
            require(msg.value <= available_size, "Can't exceed remaining allocation");
            value = msg.value;
        }

        if (alloc_id != 0) {
            Allocation storage allocation = allocations[alloc_id];
            allocation.final_size += value;
        }
        else {
            alloc_id = allocations.length;
            Allocation memory allocation = Allocation(available_size, value, false);
            allocations.push(allocation);
            allocations_for_address[_investment][msg.sender] = alloc_id;
            investment.allocations.push(alloc_id);
            emit AllocationCreated(_investment, msg.sender, available_size);
        }

        investment.invested += value;
        emit FundsSent(_investment, msg.sender, value);
    }

    function get_my_allocation(uint256 _investment) external view returns (Allocation memory) {
        uint256 alloc_id = allocations_for_address[_investment][msg.sender];
        Allocation memory allocation = allocations[alloc_id];
        return allocation;
    }

    /*
     * In case the funding goal has not been reached by investors with allocations.
    */
    function unlock_investment_for_all(uint256 _investment, uint64 _new_end_timestamp) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Investment storage investment = investments[_investment];
        require(investment.invested < investment.funding_goal);
        require(!investment.cancelled);
        investment.end_timestamp = _new_end_timestamp;
        investment.unlocked_for_all = true;
        emit InvestmentUnlockedForAll(_investment, _new_end_timestamp);
    }

    /*
     * Note: Per our understanding of the instructions we have allowed the withdrawal if the funding goal has been
     reached. However we would suggest allowing the "fund_withdrawal" only after admins send a pre-defined amount of
     tokens to the "distribute_tokens" method. The amount of tokens would be an obligatory var for Investment creation.
    */
    function withdraw_funds(uint256 _investment) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Investment storage investment = investments[_investment];
        require(investment.funding_goal == investment.invested, "The funding goal has not been met");
        require(!investment.cashed_out, "already cashed out");
        if (investment.currency_address != address(0)) {
            IERC20 token = IERC20(investment.currency_address);
            token.safeTransfer(msg.sender, investment.invested);
        }
        else {
            payable(msg.sender).transfer(investment.invested);
        }
        investment.cashed_out = true;
        emit FundsWithdrawn(_investment, investment.invested);
    }

    /*
     * E.g. in case the admins decide to refund the participants and end the investment.
    */
    function cancel_investment(uint256 _investment) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Investment storage investment = investments[_investment];
        investment.end_timestamp = uint64(block.timestamp);
        investment.cancelled = true;
    }

    /*
     * In case an investment gets cancelled, investors are allowed to claim a refund
    */
    function get_refunded(uint256 _investment) external {
        Investment memory investment = investments[_investment];
        require(investment.cancelled, "Investment not cancelled");
        uint256 alloc_id = allocations_for_address[_investment][msg.sender];
        Allocation storage allocation = allocations[alloc_id];
        require(allocation.final_size != 0, "You don't have an allocation");
        if (investment.currency_address != address(0)) {
            IERC20 token = IERC20(investment.currency_address);
            token.safeTransfer(msg.sender, allocation.final_size);
        }
        else {
            payable(msg.sender).transfer(allocation.final_size);
        }
        allocation.final_size = 0;
    }

    /*
     * A function that accepts the tokens to be distributed among participating investors.
     * Note: Ideally only after this method gets triggered with a fixed amount of tokens we would allow admins
     to withdraw funds.
    */
    function distribute_tokens(uint256 _investment, uint256 amount, IERC20 token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Investment storage investment = investments[_investment];
        require(investment.funding_goal == investment.invested, "not funded yet");
        token.safeTransferFrom(msg.sender, address(this), amount);
        investment.payout_token_address = token;
        investment.payout_token_amount = amount;
        emit TokensDistributed(_investment, token, amount);
    }

    /*
     * Allows the participating investors to claim their tokens after a successful investment funding
     * Is possible only after the tokens are sent to the "distribute_tokens" method
    */
    function collect_reward(uint256 _investment, address account) external {
        Investment memory investment = investments[_investment];
        uint256 allocation_id = allocations_for_address[_investment][account];
        Allocation storage allocation = allocations[allocation_id];
        require(!allocation.reward_paid, "reward was already paid out");
        allocation.reward_paid = true;

        uint256 payment = (investment.payout_token_amount * allocation.final_size) / investment.invested;

        require(payment != 0, "account is not due payment");

        investment.payout_token_address.safeTransfer(account, payment);
    }
}