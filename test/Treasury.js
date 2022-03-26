const { solidity } = require("ethereum-waffle");
const chai = require("chai");
const { expect, assert } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = ethers;

chai.use(solidity);

let treasury;
let testToken;
let owner;
let user1;
let user2;
let ether_address ="0x0000000000000000000000000000000000000000";
let snapshot_id;

beforeEach(async () => {
  [owner, user1, user2] = await ethers.getSigners();
  const Treasury = await ethers.getContractFactory("Treasury");
  treasury = await Treasury.deploy();
  const TestTokenContract = await ethers.getContractFactory("TestToken");
  testToken = await TestTokenContract.deploy();
  snapshot_id = await ethers.provider.send("evm_snapshot", []);
});

afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshot_id]);
});

describe("Treasury contract", function () {

  it('admin creates an investment', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 1647957509, 1648130309, ethers.utils.parseEther("2000"));
      const investment = await treasury.investments(0);
      assert.equal(investment.name, "Aventures DAO");
      assert.deepEqual(investment.funding_goal, ethers.utils.parseEther("2000"));
  });

  it("admin doesn't create an investment - end before start", async () => {
      await expect(treasury.create_investment("Aventures DAO", ether_address, 1, 0, ethers.utils.parseEther("2000"))).to.be.revertedWith("must start before it ends");
  });

  it('admin creates an allocation successfully', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("100"));
      const allocation = await treasury.allocations(1);
      assert.deepEqual(allocation.initial_size, ethers.utils.parseEther("100"));
      assert.equal(allocation.final_size, 0);
  });

  it('admin creates an allocation unsuccessfully - zero initial size', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await expect(treasury.create_allocation(0, user1.address, 0)).to.be.reverted;
  });

  it('admin creates an allocation unsuccessfully - funding period started', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 1647957509, 1648130309, ethers.utils.parseEther("1000"));
      await expect(treasury.create_allocation(0, user1.address, ethers.utils.parseEther("100"))).to.be.revertedWith("Funding period started");
  });

  it('admin creates an allocation unsuccessfully - twice for the same address', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("100"));
      await expect(treasury.create_allocation(0, user1.address, ethers.utils.parseEther("100"))).to.be.revertedWith("Already has an allocation");
  });

  it('investor funds investment successfully', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("50")});
      const allocation = await treasury.allocations(1);
      assert.deepEqual(allocation.initial_size, ethers.utils.parseEther("100"));
      assert.deepEqual(allocation.final_size, ethers.utils.parseEther("50"));
  });

  it('investor funds investment unsuccessfully - not within the funding period', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("100"));
      await expect(treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("50")})).to.be.revertedWith("Not within funding period");
  });

  it('investor funds investment unsuccessfully - exceeded allocation', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await expect(treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("500")})).to.be.revertedWith("Can't exceed remaining allocation");
  });

  it('investor funds investment unsuccessfully - exceeded allocation ERC20', async () => {
      await treasury.create_investment("Aventures DAO", testToken.address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await expect(treasury.connect(user1).fund_investment(0, ethers.utils.parseEther("500"))).to.be.revertedWith("Can't exceed remaining allocation");
  });

  it('investor funds investment unsuccessfully - sending ether with ERC20', async () => {
      await treasury.create_investment("Aventures DAO", testToken.address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await expect(treasury.connect(user1).fund_investment(0, ethers.utils.parseEther("50"), {value: 1})).to.be.reverted;
  });

  it('investor funds investment unsuccessfully - no allocation', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await expect(treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("50")})).to.be.revertedWith("No allocation for this address");
  });

  it('administrator unlocks investment to everyone - new investor', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 1647957509, 1648130309, ethers.utils.parseEther("1000"));
      await treasury.unlock_investment_for_all(0, 4803890309);
      await treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("50")});
      const allocation =  await treasury.allocations(1);
      assert.deepEqual(allocation.initial_size, ethers.utils.parseEther("1000"));
      assert.deepEqual(allocation.final_size, ethers.utils.parseEther("50"));
  });
  it('administrator unlocks investment to everyone - already allocated investor', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("100")});
      await treasury.unlock_investment_for_all(0, 4834994309);
      await treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("500")});
      const allocation =  await treasury.allocations(1);
      assert.deepEqual(allocation.initial_size, ethers.utils.parseEther("100"));
      assert.deepEqual(allocation.final_size, ethers.utils.parseEther("600"));
      await expect(treasury.allocations(2)).to.be.reverted;
  });

  it('administrator unlocks investment to everyone - investor sends over funding goal', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 1647957509, 1648130309, ethers.utils.parseEther("1000"));
      await treasury.unlock_investment_for_all(0, 4803890309);
      await expect(treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("5000")})).to.be.revertedWith("Can't exceed remaining allocation");
  });

  it('administrator unlocks investment to everyone - cancelled', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 1647957509, 1648130309, ethers.utils.parseEther("1000"));
      await treasury.cancel_investment(0)
      await expect(treasury.unlock_investment_for_all(0, 4803890309)).to.be.reverted;
  });

  it('administrator unlocks investment to everyone - already funded', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("1000")});
      await expect(treasury.unlock_investment_for_all(0, 4803890309)).to.be.reverted;
  });

  it('administrator withdraws funds successfully', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("1000")});
      const balance_before = await ethers.provider.getBalance(owner.address);
      await treasury.withdraw_funds(0);
      const balance_after = await ethers.provider.getBalance(owner.address);
      const difference = balance_after.sub(balance_before);
      expect(difference).to.be.closeTo(ethers.utils.parseEther("1000"),ethers.utils.parseEther("0.1"))
  });

    it('administrator withdraws funds successfully - ERC20.', async () => {
      await treasury.create_investment("Aventures DAO", testToken.address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await testToken.mint(user1.address, ethers.utils.parseEther("1000"));
      await testToken.connect(user1).approve(treasury.address, ethers.utils.parseEther("1000"));
      await treasury.connect(user1).fund_investment(0, ethers.utils.parseEther("1000"));
      const balance_before = await testToken.balanceOf(owner.address);
      await treasury.withdraw_funds(0);
      const balance_after = await testToken.balanceOf(owner.address)
      const difference = balance_after.sub(balance_before);
      expect(difference).to.equal(ethers.utils.parseEther("1000"));
  });

  it('administrator withdraws funds unsuccessfully - funding goal not met', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("50")});
      await expect(treasury.withdraw_funds(0)).to.be.revertedWith("The funding goal has not been met");
  });

  it('administrator distributes tokens and investor collects them', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("1000")});

      await ethers.provider.send("evm_setNextBlockTimestamp", [4803890309]);
      await ethers.provider.send("evm_mine");
      await testToken.approve(treasury.address, 100000);
      await treasury.distribute_tokens(0, 100000, testToken.address);

      await treasury.connect(user1).collect_reward(0, user1.address);
  });

  it('administrator cannot distribute tokens when funding period is not over', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await expect(treasury.distribute_tokens(0, 100000, testToken.address)).to.be.revertedWith("The funding period is not over");

  });

  it('investor cannot collect reward multiple times', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("1000")});

      await ethers.provider.send("evm_setNextBlockTimestamp", [4803890309]);
      await ethers.provider.send("evm_mine");
      await testToken.approve(treasury.address, 100000);
      await treasury.distribute_tokens(0, 100000, testToken.address);
      await treasury.connect(user1).collect_reward(0, user1.address);

      await expect(treasury.connect(user1).collect_reward(0, user1.address)).to.be.revertedWith("reward was already paid out");
  });

  it("investor is not rewarded when they haven't invested", async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("1000")});
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803890309]);
      await ethers.provider.send("evm_mine");
      await testToken.approve(treasury.address, 100000);
      await treasury.distribute_tokens(0, 100000, testToken.address);

      await expect(treasury.connect(user2).collect_reward(0, user2.address)).to.be.revertedWith("account is not due payment");
  });

  it('administrator cancels investment', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("50")});
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803890310]);
      await ethers.provider.send("evm_mine");
      await expect(treasury.withdraw_funds(0)).to.be.revertedWith("The funding goal has not been met");
      await treasury.cancel_investment(0);
      await expect(treasury.withdraw_funds(0)).to.be.revertedWith("The funding goal has not been met");
      const investment = await treasury.investments(0);
      assert.isTrue(investment.cancelled);
  });

  it('investor withdraws their funds from a cancelled investment', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("50")});
      await treasury.cancel_investment(0);
      const balance_before = await ethers.provider.getBalance(user1.address);
      await treasury.connect(user1).get_refunded(0);
      const balance_after = await ethers.provider.getBalance(user1.address);
      const difference = balance_after.sub(balance_before);
      expect(difference).to.be.closeTo(ethers.utils.parseEther("50"),ethers.utils.parseEther("0.1"));
  });

  it('investor withdraws their funds from a cancelled investment - ERC20', async () => {
      await treasury.create_investment("Aventures DAO", testToken.address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await testToken.mint(user1.address, ethers.utils.parseEther("500"));
      await testToken.connect(user1).approve(treasury.address, ethers.utils.parseEther("500"));
      await treasury.connect(user1).fund_investment(0, ethers.utils.parseEther("500"));
      await treasury.cancel_investment(0);
      const balance_before = await testToken.balanceOf(owner.address);
      await treasury.connect(user1).get_refunded(0);
      const balance_after = await testToken.balanceOf(owner.address);
      const difference = balance_after.sub(balance_before);
      expect(difference).to.be.equal(ethers.utils.parseEther("0"));
  });

  it('investor tries to withdraw their funds from a NOT cancelled investment', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [4803803910]);
      await ethers.provider.send("evm_mine");
      await treasury.connect(user1).fund_investment(0, 0, {value: ethers.utils.parseEther("50")});
      const balance_before = await ethers.provider.getBalance(user1.address);
      await expect(treasury.connect(user1).get_refunded(0)).to.be.revertedWith("Investment not cancelled");
      const balance_after = await ethers.provider.getBalance(user1.address);
      const difference = balance_after.sub(balance_before);
      expect(difference).to.be.closeTo(ethers.utils.parseEther("0.01"),ethers.utils.parseEther("0.1"));
  });
  it('non investor tries to withdraw funds from a cancelled investment', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.cancel_investment(0);
      const balance_before = await ethers.provider.getBalance(user1.address);
      await expect(treasury.connect(user1).get_refunded(0)).to.be.revertedWith("You don't have an allocation");
      const balance_after = await ethers.provider.getBalance(user1.address);
      const difference = balance_after.sub(balance_before);
      expect(difference).to.be.closeTo(ethers.utils.parseEther("0.01"),ethers.utils.parseEther("0.1"));
  });
  it('investor and non investor try to get their allocation', async () => {
      await treasury.create_investment("Aventures DAO", ether_address, 4803803909, 4803890309, ethers.utils.parseEther("1000"));
      await treasury.create_allocation(0, user1.address, ethers.utils.parseEther("500"));
      const alloc1 = await treasury.connect(user1).get_my_allocation(0);
      assert.deepEqual(alloc1.initial_size, ethers.utils.parseEther("500"));
      const alloc2 = await treasury.connect(user2).get_my_allocation(0);
      assert.deepEqual(alloc2.initial_size, BigNumber.from("0"));
  });
});
