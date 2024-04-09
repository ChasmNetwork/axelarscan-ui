'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import clsx from 'clsx'
import _ from 'lodash'

import { Container } from '@/components/Container'
import { Image } from '@/components/Image'
import { Copy } from '@/components/Copy'
import { Tooltip } from '@/components/Tooltip'
import { ProgressBar } from '@/components/ProgressBar'
import { Spinner } from '@/components/Spinner'
import { Tag } from '@/components/Tag'
import { Number } from '@/components/Number'
import { Profile } from '@/components/Profile'
import { useGlobalStore } from '@/components/Global'
import { getValidatorsVotes, getChainMaintainers } from '@/lib/api/validator'
import { getChainData } from '@/lib/config'
import { toArray } from '@/lib/parser'
import { equalsIgnoreCase, ellipse } from '@/lib/string'
import { isNumber, toNumber, formatUnits, toFixed, numberFormat } from '@/lib/number'

export const useValidatorStore = create()(set => ({
  maintainers: null,
  setMaintainers: data => set(state => ({ ...state, maintainers: { ...state.maintainers, ...data } })),
}))

const statuses = ['active', 'inactive']

export function Validators({ status }) {
  const [EVMChains, setEVMChains] = useState(null)
  const [validatorsVotes, setValidatorsVotes] = useState(null)
  const [data, setData] = useState(null)
  const { chains, contracts, validators, inflationData, networkParameters } = useGlobalStore()
  const { maintainers, setMaintainers } = useValidatorStore()

  useEffect(() => {
    if (chains && contracts) setEVMChains(toArray(chains).filter(d => d.chain_type ==='evm' && contracts.gateway_contracts?.[d.id]?.address))
  }, [chains, contracts, setEVMChains])

  useEffect(() => {
    const getData = async () => {
      if (EVMChains) {
        setMaintainers(Object.fromEntries(toArray(
          await Promise.all(EVMChains.filter(d => !maintainers?.[d.id]).map(d => new Promise(async resolve => {
            const { maintainers } = { ...await getChainMaintainers({ chain: d.id }) }
            resolve([d.id, toArray(maintainers)])
          })))
        )))
      }
    }
    getData()
  }, [EVMChains, setMaintainers])

  useEffect(() => {
    const getData = async () => {
      const response = await getValidatorsVotes()
      if (response?.data) setValidatorsVotes(response)
    }
    getData()
  }, [setValidatorsVotes])

  useEffect(() => {
    if (EVMChains && validatorsVotes && validators && inflationData && networkParameters && Object.keys({ ...maintainers }).length === EVMChains.length) {
      const { tendermintInflationRate, keyMgmtRelativeInflationRate, externalChainVotingInflationRate, communityTax } = { ...inflationData }
      const { bankSupply, stakingPool } = { ...networkParameters }

      const _data = _.orderBy(validators.map(d => {
        const { rate } = { ...d.commission?.commission_rates }

        if (validatorsVotes?.data) {
          d.total_polls = toNumber(validatorsVotes.total)
          d.votes = { ...validatorsVotes.data[d.broadcaster_address] }
          d.total_votes = toNumber(d.votes.total)

          const getVoteCount = (vote, votes) => _.sum(Object.values({ ...votes }).map(v => toNumber(_.last(Object.entries({ ...v?.votes }).find(([k, v]) => equalsIgnoreCase(k, vote?.toString()))))))
          d.total_yes_votes = getVoteCount(true, d.votes.chains)
          d.total_no_votes = getVoteCount(false, d.votes.chains)
          d.total_unsubmitted_votes = getVoteCount('unsubmitted', d.votes.chains)
        }

        const supportedChains = Object.entries(maintainers).filter(([k, v]) => v.includes(d.operator_address)).map(([k, v]) => k)
        const inflation = toFixed(
          ((d.uptime / 100) * toNumber(tendermintInflationRate)) +
          ((isNumber(d.heartbeats_uptime) ? d.heartbeats_uptime / 100 : 1) * toNumber(keyMgmtRelativeInflationRate) * toNumber(tendermintInflationRate)) +
          (toNumber(externalChainVotingInflationRate) * _.sum(supportedChains.map(c => {
            const { total, total_polls } = { ...d.votes?.chains?.[c] }
            return 1 - (total_polls ? (total_polls - total) / total_polls : 0)
          }))), 6
        )

        return {
          ...d,
          inflation,
          apr: (inflation * 100) * formatUnits(bankSupply?.amount, 6) * (1 - toNumber(communityTax)) * (1 - toNumber(rate)) / formatUnits(stakingPool?.bonded_tokens, 6),
          supportedChains,
          votes: d.votes && { ...d.votes, chains: Object.fromEntries(Object.entries({ ...d.votes.chains }).filter(([k, v]) => supportedChains.includes(k))) },
        }
      }), ['quadratic_voting_power', 'tokens'], ['desc', 'desc'])

      if (!_.isEqual(_data, data)) setData(_data)
    }
  }, [status, EVMChains, validatorsVotes, data, validators, inflationData, networkParameters, maintainers, setData])

  const filter = status => toArray(data).filter(d => status === 'inactive' ? d.status !== 'BOND_STATUS_BONDED' : d.status === 'BOND_STATUS_BONDED' && !d.jailed)

  return (
    <Container className="sm:mt-8">
      {!data ? <Spinner /> :
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-x-4 gap-y-4 sm:gap-y-0">
            <div className="sm:flex-auto">
              <h1 className="text-zinc-900 dark:text-zinc-100 text-base font-semibold leading-6">Validators</h1>
              <p className="mt-2 text-zinc-400 dark:text-zinc-500 text-sm">
                List of {status || 'active'} validators in Axelar Network with the latest 10K blocks performance.
              </p>
            </div>
            <nav className="flex gap-x-4">
              {statuses.map((d, i) => (
                <Link
                  key={i}
                  href={`/validators${d !== 'active' ? `/${d}` : ''}`}
                  className={clsx(
                    'rounded-md px-3 py-2 capitalize text-base font-medium',
                    d === (status || 'active') ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300' : 'text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-400',
                  )}
                >
                  {d} ({filter(d).length})
                </Link>
              ))}
            </nav>
          </div>
          <div className="overflow-x-auto lg:overflow-x-visible -mx-4 sm:-mx-0 mt-4">
            <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
              <thead className="sticky top-0 z-10 bg-white dark:bg-zinc-900">
                <tr className="text-zinc-800 dark:text-zinc-200 text-sm font-semibold">
                  <th scope="col" className="pl-4 sm:pl-0 pr-3 py-3.5 text-left">
                    #
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left">
                    Validator
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left whitespace-nowrap">
                    {status === 'active' ? 'Consensus Power' : 'Staking'}
                  </th>
                  {status === 'active' && (
                    <th scope="col" className="px-3 py-3.5 text-left whitespace-nowrap">
                      Quadratic Power
                    </th>
                  )}
                  <th scope="col" className="hidden sm:table-cell px-3 py-3.5 text-left">
                    Uptime
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left">
                    Heartbeat
                  </th>
                  <th scope="col" className="hidden sm:table-cell px-3 py-3.5 text-left whitespace-nowrap">
                    EVM Votes
                  </th>
                  <th scope="col" className="pl-3 pr-4 sm:pr-0 py-3.5 text-left whitespace-nowrap">
                    EVM Supported
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
                {filter(status).map((d, i) => {
                  const { rate } = { ...d.commission?.commission_rates }
                  const totalVotingPower = _.sumBy(filter(status), 'tokens')
                  const totalQuadraticVotingPower = _.sumBy(filter(status), 'quadratic_voting_power')
                  const cumulativeVotingPower = _.sumBy(_.slice(filter(status), 0, i + 1), 'tokens')
                  const cumulativeQuadraticVotingPower = _.sumBy(_.slice(filter(status), 0, i + 1), 'quadratic_voting_power')

                  return (
                    <tr key={i} className="align-top text-zinc-400 dark:text-zinc-500 text-sm">
                      <td className="pl-4 sm:pl-0 pr-3 py-4 text-left">
                        {i + 1}
                      </td>
                      <td className="px-3 py-4 text-left">
                        <div className="flex flex-col gap-y-0.5">
                          <Profile i={i} address={d.operator_address} prefix="axelarvaloper" />
                          <Copy value={d.operator_address}>
                            <span className="text-zinc-400 dark:text-zinc-500 font-medium">
                              {ellipse(d.operator_address, 6, 'axelarvaloper')}
                            </span>
                          </Copy>
                          {isNumber(rate) && (
                            <Number
                              value={rate * 100}
                              maxDecimals={2}
                              prefix="Commission: "
                              suffix="%"
                              noTooltip={true}
                              className="text-zinc-400 dark:text-zinc-500 font-medium"
                            />
                          )}
                          {isNumber(d.inflation) && (
                            <Number
                              value={d.inflation * 100}
                              maxDecimals={2}
                              prefix="Inflation: "
                              suffix="%"
                              noTooltip={true}
                              className="text-zinc-400 dark:text-zinc-500 font-medium"
                            />
                          )}
                          {isNumber(d.apr) && (
                            <Number
                              value={d.apr}
                              maxDecimals={2}
                              prefix="APR: "
                              suffix="%"
                              noTooltip={true}
                              className="text-zinc-400 dark:text-zinc-500 font-medium"
                            />
                          )}
                          {(status === 'inactive' || d.status !== 'BOND_STATUS_BONDED') && (
                            <>
                              {d.status && (
                                <Tag className={clsx('w-fit', d.status.includes('UN') ? d.status.endsWith('ED') ? 'bg-red-600 dark:bg-red-500' : 'bg-orange-500 dark:bg-orange-600' : 'bg-green-600 dark:bg-green-500')}>
                                  {d.status.replace('BOND_STATUS_', '')}
                                </Tag>
                              )}
                              {d.jailed && (
                                <Tag className="w-fit bg-red-600 dark:bg-red-500">
                                  Jailed
                                </Tag>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-left">
                        {isNumber(d.tokens) && (
                          <div className="max-w-32 grid gap-y-2">
                            <div className="flex items-center gap-x-2">
                              <Number
                                value={d.tokens}
                                format="0,0.0a"
                                noTooltip={true}
                                className="text-zinc-900 dark:text-zinc-100 font-medium"
                              />
                              {status === 'active' && (
                                <Number
                                  value={d.tokens * 100 / totalVotingPower}
                                  format="0,0.0a"
                                  prefix="("
                                  suffix="%)"
                                  noTooltip={true}
                                  className="text-zinc-400 dark:text-zinc-500"
                                />
                              )}
                            </div>
                            {status === 'active' && <ProgressBar value={cumulativeVotingPower * 100 / totalVotingPower} />}
                          </div>
                        )}
                      </td>
                      {status === 'active' && (
                        <td className="px-3 py-4 text-left">
                          {isNumber(d.quadratic_voting_power) && (
                            <div className="max-w-32 grid gap-y-2">
                              <div className="flex items-center gap-x-2">
                                <Number
                                  value={d.quadratic_voting_power}
                                  format="0,0.0a"
                                  noTooltip={true}
                                  className="text-zinc-900 dark:text-zinc-100 font-medium"
                                />
                                <Number
                                  value={d.quadratic_voting_power * 100 / totalQuadraticVotingPower}
                                  format="0,0.0a"
                                  prefix="("
                                  suffix="%)"
                                  noTooltip={true}
                                  className="text-zinc-400 dark:text-zinc-500"
                                />
                              </div>
                              <ProgressBar value={cumulativeQuadraticVotingPower * 100 / totalQuadraticVotingPower} className="bg-orange-400 dark:bg-orange-500" />
                            </div>
                          )}
                        </td>
                      )}
                      <td className="hidden sm:table-cell px-3 py-4 text-left">
                        <div className="min-w-24 max-w-24 grid gap-y-2 my-0.5">
                          {isNumber(d.uptime) && <ProgressBar value={d.uptime} className={clsx(d.uptime < 50 ? 'bg-red-600 dark:bg-red-500' : d.uptime < 80 ? 'bg-yellow-400 dark:bg-yellow-500' : 'bg-green-600 dark:bg-green-500')} />}
                          {status === 'active' && isNumber(d.proposed_blocks) && (
                            <div className="flex flex-col">
                              <span className="text-zinc-400 dark:text-zinc-500 text-xs whitespace-nowrap">Proposed Block</span>
                              <div className="flex items-center gap-x-2">
                                <Number
                                  value={d.proposed_blocks}
                                  format="0,0.0a"
                                  noTooltip={true}
                                  className="text-zinc-900 dark:text-zinc-100 font-medium"
                                />
                                <Number
                                  value={d.proposed_blocks_proportion}
                                  format="0,0.0a"
                                  prefix="("
                                  suffix="%)"
                                  noTooltip={true}
                                  className="text-zinc-400 dark:text-zinc-500"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-left">
                        <div className="min-w-24 max-w-24 flex flex-col gap-y-2 my-0.5">
                          {isNumber(d.heartbeat_uptime) && <ProgressBar value={d.heartbeat_uptime} className={clsx(d.heartbeat_uptime < 50 ? 'bg-red-600 dark:bg-red-500' : d.heartbeat_uptime < 80 ? 'bg-yellow-400 dark:bg-yellow-500' : 'bg-green-600 dark:bg-green-500')} />}
                          {d.stale_heartbeats && (
                            <span className="text-red-600 dark:text-red-500 text-xs font-medium whitespace-nowrap">
                              Stale Heartbeats
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-3 py-4 text-left">
                        <div className="min-w-48 grid grid-cols-2 gap-x-2 gap-y-1">
                          {_.orderBy(Object.entries(d.votes.chains).map(([k, v]) => ({ chain: k, ...v })), ['total_polls'], ['desc']).map(d => {
                            const { name, image } = { ...getChainData(d.chain, chains) }
                            const votesDetails = ['true', 'false', 'unsubmitted'].map(s => [s === 'true' ? 'Y' : s === 'false' ? 'N' : 'UN', d.votes[s]]).filter(([k, v]) => v).map(([k, v]) => `${numberFormat(v, '0,0')}${k}`).join(' / ')

                            return (
                              <div key={d.chain} className="flex justify-start">
                                <Tooltip content={`${name}: ${votesDetails}`} className="whitespace-nowrap">
                                  <div className="flex items-center gap-x-2">
                                    <Image
                                      src={image}
                                      alt=""
                                      width={20}
                                      height={20}
                                    />
                                    <div className="flex items-center gap-x-1">
                                      <Number
                                        value={d.total}
                                        format="0,0.0a"
                                        noTooltip={true}
                                        className={clsx('text-xs font-medium', d.total < d.total_polls ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-900 dark:text-zinc-100')}
                                      />
                                      <Number
                                        value={d.total_polls}
                                        format="0,0.0a"
                                        prefix=" / "
                                        noTooltip={true}
                                        className="text-zinc-900 dark:text-zinc-100 text-xs font-medium"
                                      />
                                    </div>
                                  </div>
                                </Tooltip>
                              </div>
                            )
                          })}
                        </div>
                      </td>
                      <td className="pl-3 pr-4 sm:pr-0 py-4 text-left">
                        <div className="max-w-40 flex flex-wrap">
                          {d.supportedChains.map((c, j) => {
                            const { name, image } = { ...getChainData(c, chains) }
                            return (
                              <Tooltip key={j} content={name} className="whitespace-nowrap">
                                <Image
                                  src={image}
                                  alt=""
                                  width={20}
                                  height={20}
                                  className="mr-1.5 mb-1.5"
                                />
                              </Tooltip>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      }
    </Container>
  )
}
