// Copyright (c) 2014-2017, MyMonero.com
//
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without modification, are
// permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this list of
//	conditions and the following disclaimer.
//
// 2. Redistributions in binary form must reproduce the above copyright notice, this list
//	of conditions and the following disclaimer in the documentation and/or other
//	materials provided with the distribution.
//
// 3. Neither the name of the copyright holder nor the names of its contributors may be
//	used to endorse or promote products derived from this software without specific
//	prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
// EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
// THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
// PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
// STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
// THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
"use strict"
//
const EventEmitter = require('events')
const async = require('async')
//
class ListBaseController extends EventEmitter
{	
	//
	//
	// Lifecycle - Initialization
	//
	constructor(options, context)
	{
		super() // must call super before we can access `this`
		//
		const self = this
		self.options = options
		self.context = context
		{
			self.hasBooted = false // not booted yet - we'll defer things till we have
		}
		self.setup()
	}
	_setup_didBoot(optlFn)
	{
		const self = this
		optlFn = optlFn || function() {}
		{
			self.hasBooted = true // all done!
		}
		setTimeout(function()
		{ // on next tick to avoid instantiator missing this
			self.emit(self.EventName_booted())
			optlFn()
		})
	}
	_setup_didFailToBootWithError(err)
	{
		const self = this
		setTimeout(function()
		{ // on next tick to avoid instantiator missing this
			self.emit(self.EventName_errorWhileBooting(), err)
		})
	}
	setup()
	{
		const self = this
		self.context.passwordController.AddRegistrantForDeleteEverything(self)
		self.startObserving_passwordController()
		//
		self._tryToBoot() // TODO: boot lazily? (on whenbooted request)
	}
	_tryToBoot()
	{
		const self = this
		self._setup_fetchAndReconstituteExistingRecords()
	}
	_setup_fetchAndReconstituteExistingRecords(optl_isForSetup)
	{
		const isForSetup = optl_isForSetup === true ? true : false
		const self = this
		self.records = [] // going to zero this from the start
		self._new_idsOfPersistedRecords( // now first want to check if we really want to trigger showing the PW entry screen yet (not part of onboarding til user initiates!)
			function(err, ids)
			{
				if (err) {
					self._setup_didFailToBootWithError(err)
					return
				}
				if (ids.length === 0) { // do not cause the pw to be requested yet
					self._setup_didBoot()
					// and we don't want/need to emit that the list updated here
					return
				}
				__proceedTo_requestPasswordAndLoadRecords()
			}
		)
		function __proceedTo_requestPasswordAndLoadRecords() // but do not pass in ids cause they'll get stale if we wait for pw after a Delete Everything
		{
			self.context.passwordController.WhenBootedAndPasswordObtained_PasswordAndType( // this will block until we have access to the pw
				function(obtainedPasswordString, userSelectedTypeOfPassword)
				{
					__proceedTo_loadAndBootAllExtantRecordsWithPassword(obtainedPasswordString)
				}
			)
		}
		function __proceedTo_loadAndBootAllExtantRecordsWithPassword(persistencePassword)
		{ // we want to load the ids again after we have the password - or we'll have stale ids on having deleted all data in the app and subsequently adding a record!
			self._new_idsOfPersistedRecords(
				function(err, ids)
				{
					if (err) {
						const errStr = "Error fetching persisted record ids: " + err.message
						const err = new Error(errStr)
						self._setup_didFailToBootWithError(err)
						return
					}
					if (ids.length === 0) { // do not cause the pw to be requested yet
						self._setup_didBoot()
						// and we don't want/need to emit that the list updated here
						return
					}
					__proceedTo_loadRecordsWithIds(ids, persistencePassword)
				}
			)
		}
		function __proceedTo_loadRecordsWithIds(ids, persistencePassword)
		{
			async.each(
				ids,
				function(_id, cb)
				{
					const forOverrider_instance_didBoot_fn = function(err, recordInstance)
					{ // ^-- NOTE: even though this is the success fn, you may pass an error here 
						// for instances which could not be decrypted but which you want to not
						// prevent booting so the user could delete them 
						if (err) {
							console.error("Failed to initialize record ", err, recordInstance)
							// but we're not going to call cb with err because that prevents boot - the instance will be marked as 'errored' and we'll display it/able to treat it as such
						} else {
							// console.log("💬  Initialized record", recordInstance.Description())
						}
						self.records.push(recordInstance) // we manually manage the list here and
						// thus take responsibility to emit EventName_listUpdated below
						self.overridable_startObserving_record(recordInstance) // taking responsibility to start observing
						//
						cb()
					}
					const forOverrider_instance_didFailBoot_fn = function(err, recordInstance)
					{ 
						if (err) {
							console.error("Failed to initialize record ", err, recordInstance)
						} else {
							// console.log("💬  Initialized record", recordInstance.Description())
						}
						cb(err) // we're going to consider this a fatal err by passing the `err` to cb
						// which will halt boot - so only call forOverrider_instance_didFailBoot_fn 
						// when necessary (and not necessarily on a decrypt error)
					}
					const RecordClass = self.override_lookup_RecordClass()
					const optionsBase =
					{
						_id: _id
					}
					// now give overrider chance to customize options
					self.override_booting_reconstituteRecordInstanceOptionsWithBase(
						optionsBase,
						persistencePassword,
						forOverrider_instance_didBoot_fn,
						forOverrider_instance_didFailBoot_fn
					)
					const finalized_options = optionsBase
					const createTime_referenceTo_recordInstance = new RecordClass(finalized_options, self.context)
					// ^-- no need to hang onto this as recordInstance ref is passed through the above for…_fn callbacks
				},
				function(err)
				{
					if (err) {
						console.error("Fatal error fetching persisted records", err)
						self._setup_didFailToBootWithError(err)
						return
					}
					self.overridable_sortRecords(
						function()
						{
							self._setup_didBoot(function()
							{ // in cb to ensure serialization of calls
								self.__listUpdated_records() // emit after booting so this becomes an at-runtime emission
							})
						}
					)
				}
			)
		}
	}
	override_CollectionName()
	{ // Return a string such as "Wallets", i.e. as declared at {recordName}_persistence_utils.CollectionName
		const self = this
		throw `[${self.constructor.name}/overridable_CollectionName]: You must implement this method.`
	}
	override_lookup_RecordClass()
	{ // Return a `class`, i.e. as declared in a module
		const self = this
		throw `[${self.constructor.name}/override_lookup_RecordClass]: You must implement this method.`
	}
	override_booting_reconstituteRecordInstanceOptionsWithBase(
		optionsBase_withCBs,
		persistencePassword,
		forOverrider_instance_didBoot_fn,
		forOverrider_instance_didFailBoot_fn
	)
	{
		const self = this
		throw `[${self.constructor.name}/override_booting_reconstituteRecordInstanceOptionsWithBase]: You must implement this method and call at least one of the appropriate callbacks.`
	}
	overridable_sortRecords(fn) // () -> Void
	{ // do not call super or fn could be called twice - unless you want to call super to return (which might not be advisable as the behavior of this `super` fn is not defined/guaranted to call fn for you)
		const self = this
		fn() // overriders must call this
	}
	startObserving_passwordController()
	{
		const self = this
		const controller = self.context.passwordController
		{ // EventName_ChangedPassword
			if (self._passwordController_EventName_ChangedPassword_listenerFn !== null && typeof self._passwordController_EventName_ChangedPassword_listenerFn !== 'undefined') {
				throw "self._passwordController_EventName_ChangedPassword_listenerFn not nil in " + self.constructor.name
			}
			self._passwordController_EventName_ChangedPassword_listenerFn = function()
			{
				self._passwordController_EventName_ChangedPassword()
			}
			controller.on(
				controller.EventName_ChangedPassword(),
				self._passwordController_EventName_ChangedPassword_listenerFn
			)
		}
		{ // EventName_willDeconstructBootedStateAndClearPassword
			if (self._passwordController_EventName_willDeconstructBootedStateAndClearPassword_listenerFn !== null && typeof self._passwordController_EventName_willDeconstructBootedStateAndClearPassword_listenerFn !== 'undefined') {
				throw "self._passwordController_EventName_willDeconstructBootedStateAndClearPassword_listenerFn not nil in " + self.constructor.name
			}
			self._passwordController_EventName_willDeconstructBootedStateAndClearPassword_listenerFn = function()
			{
				self._passwordController_EventName_willDeconstructBootedStateAndClearPassword()
			}
			controller.on(
				controller.EventName_willDeconstructBootedStateAndClearPassword(),
				self._passwordController_EventName_willDeconstructBootedStateAndClearPassword_listenerFn
			)
		}
		{ // EventName_didDeconstructBootedStateAndClearPassword
			if (self._passwordController_EventName_didDeconstructBootedStateAndClearPassword_listenerFn !== null && typeof self._passwordController_EventName_didDeconstructBootedStateAndClearPassword_listenerFn !== 'undefined') {
				throw "self._passwordController_EventName_didDeconstructBootedStateAndClearPassword_listenerFn not nil in " + self.constructor.name
			}
			self._passwordController_EventName_didDeconstructBootedStateAndClearPassword_listenerFn = function()
			{
				self._passwordController_EventName_didDeconstructBootedStateAndClearPassword()
			}
			controller.on(
				controller.EventName_didDeconstructBootedStateAndClearPassword(),
				self._passwordController_EventName_didDeconstructBootedStateAndClearPassword_listenerFn
			)
		}		
	}
	

	////////////////////////////////////////////////////////////////////////////////
	// Lifecycle/Runtime - Teardown
	
	TearDown()
	{
		const self = this
		self._tearDown_records()
		self._stopObserving_passwordController()
	}
	_tearDown_records()
	{
		const self = this
		const records = self.records
		const records_length = records.length
		for (let i = 0 ; i < records_length ; i++) {
			const record = records[i]
			record.TearDown()
		}
	}
	//
	_stopObserving_passwordController()
	{
		const self = this
		const controller = self.context.passwordController
		{ // EventName_ChangedPassword
			if (typeof self._passwordController_EventName_ChangedPassword_listenerFn === 'undefined' || self._passwordController_EventName_ChangedPassword_listenerFn === null) {
				throw "self._passwordController_EventName_ChangedPassword_listenerFn undefined"
			}
			controller.removeListener(
				controller.EventName_ChangedPassword(),
				self._passwordController_EventName_ChangedPassword_listenerFn
			)
			self._passwordController_EventName_ChangedPassword_listenerFn = null
		}
		{ // EventName_willDeconstructBootedStateAndClearPassword
			if (typeof self._passwordController_EventName_willDeconstructBootedStateAndClearPassword_listenerFn === 'undefined' || self._passwordController_EventName_willDeconstructBootedStateAndClearPassword_listenerFn === null) {
				throw "self._passwordController_EventName_willDeconstructBootedStateAndClearPassword_listenerFn undefined"
			}
			controller.removeListener(
				controller.EventName_willDeconstructBootedStateAndClearPassword(),
				self._passwordController_EventName_willDeconstructBootedStateAndClearPassword_listenerFn
			)
			self._passwordController_EventName_willDeconstructBootedStateAndClearPassword_listenerFn = null
		}
		{ // EventName_didDeconstructBootedStateAndClearPassword
			if (typeof self._passwordController_EventName_didDeconstructBootedStateAndClearPassword_listenerFn === 'undefined' || self._passwordController_EventName_didDeconstructBootedStateAndClearPassword_listenerFn === null) {
				throw "self._passwordController_EventName_didDeconstructBootedStateAndClearPassword_listenerFn undefined"
			}
			controller.removeListener(
				controller.EventName_didDeconstructBootedStateAndClearPassword(),
				self._passwordController_EventName_didDeconstructBootedStateAndClearPassword_listenerFn
			)
			self._passwordController_EventName_didDeconstructBootedStateAndClearPassword_listenerFn = null
		}
	}
	//
	//
	// Booting/Booted - Accessors - Public - Events emitted
	//
	EventName_booted()
	{
		return "EventName_booted"
	}
	EventName_errorWhileBooting()
	{
		return "EventName_errorWhileBooting"
	}
	EventName_listUpdated() // -> String
	{
		return "EventName_listUpdated"
	}
	EventName_deletedRecordWithId()
	{
		return "EventName_deletedRecordWithId"
	}
	//
	//
	// Runtime - Accessors - Private - Lookups - Documents & instances
	//
	_new_idsOfPersistedRecords(
		fn // (err?, ids?) -> Void
	)
	{
		const self = this
		self.context.persister.IdsOfAllDocuments(
			self.override_CollectionName(),
			function(err, ids)
			{
				if (err) {
					console.error(err)
					fn(err)
					return
				}
				fn(null, ids)
			}
		)
	}
	__recordInstanceAndIndexWithId(_id)
	{
		const self = this
		const records_length = self.records.length
		for (let i = 0 ; i < records_length ; i++) {
			const record = self.records[i]
			if (record._id === _id) {
				return {
					index: i,
					instance: record
				}
			}
		}
		throw "Record unexpectedly not found"
	}
	//
	//
	// Booted - Accessors - Public
	//
	WhenBooted_Records(fn)
	{
		const self = this
		self.ExecuteWhenBooted(
			function()
			{
				fn(self.records)
			}
		)
	}
	//
	//
	// Runtime - Imperatives - Public - Deferring control til boot
	//
	ExecuteWhenBooted(fn)
	{
		const self = this
		if (self.hasBooted === true) {
			fn()
			return
		}
		setTimeout(
			function()
			{
				self.ExecuteWhenBooted(fn)
			},
			50 // ms
		)
	}
	//
	//
	// Runtime - Imperatives - CRUD - (D)eletion
	//
	WhenBooted_DeleteRecordWithId(
		_id,
		fn
	)
	{
		const self = this
		//
		self.ExecuteWhenBooted(
			function()
			{
				const instanceAndIndex = self.__recordInstanceAndIndexWithId(_id)
				var indexOfRecord = instanceAndIndex.index
				var recordInstance = instanceAndIndex.instance
				if (indexOfRecord === null || recordInstance === null) {
					fn(new Error("Record not found"))
					return
				}
				self.givenBooted_DeleteRecordAtIndex(
					recordInstance,
					indexOfRecord,
					fn
				)
			}
		)
	}
	givenBooted_DeleteRecord(
		recordInstance,
		fn
	)
	{
		const self = this
		const indexOfRecord = self.__recordInstanceAndIndexWithId(recordInstance._id)
		self.givenBooted_DeleteRecordAtIndex(
			recordInstance,
			indexOfRecord,
			fn
		)
	}
	givenBooted_DeleteRecordAtIndex(
		recordInstance,
		indexOfRecord,
		fn
	)
	{
		const self = this
		//
		recordInstance.TearDown() // stop polling, etc -- important.
		//
		self.overridable_stopObserving_record(recordInstance) // important
		self.records.splice(indexOfRecord, 1) // pre-emptively remove the record from the list
		self.emit(self.EventName_deletedRecordWithId(), recordInstance._id)
		self.__listUpdated_records() // ensure delegate notified
		//
		recordInstance.Delete(
			function(err)
			{
				fn(err)
			}
		)
	}
	//
	//
	// Runtime - Delegation - Post-instantiation hook
	//
	RuntimeContext_postWholeContextInit_setup() {}
	//
	//
	//
	// Runtime - Imperatives - Private - Event observation - Records
	//
	overridable_startObserving_record(record)
	{
		const self = this
	}
	overridable_stopObserving_record(record)
	{
		const self = this
	}
	//
	//
	// Runtime/Boot - Delegation - Private - List updating/instance management
	//
	_atRuntime__record_wasSuccessfullySetUpAfterBeingAdded(recordInstance)
	{
		const self = this
		self.records.unshift(recordInstance) // so we add it to the top
		self.overridable_startObserving_record(recordInstance)
		//
		if (self.overridable_shouldSortOnEveryRecordAdditionAtRuntime()) {
			self.overridable_sortRecords(function()
			{
				self.__listUpdated_records()
			})
		} else {
			self.__listUpdated_records()
		}
	}
	overridable_shouldSortOnEveryRecordAdditionAtRuntime()
	{
		return false
	}
	__listUpdated_records()
	{
		const self = this
		self.emit(self.EventName_listUpdated())
	}
	//
	//
	// Runtime/Boot - Delegation - Private
	//
	_passwordController_EventName_ChangedPassword()
	{
		const self = this
		if (self.hasBooted !== true) {
			console.warn("⚠️  " + self.constructor.name + " asked to ChangePassword but not yet booted.")
			return // critical: not ready to get this 
		}
		// change all record passwords:
		const toPassword = self.context.passwordController.password // we're just going to directly access it here because getting this event means the passwordController is also saying it's ready
		self.records.forEach(
			function(record, i)
			{
				if (record.didFailToInitialize_flag !== true && record.didFailToBoot_flag !== true) {
					record.ChangePasswordTo(
						toPassword,
						function(err)
						{
							// err is logged in ChangePasswordTo
							// TODO: is there any sensible strategy to handle failures here?
						}
					)
				} else {
					console.warn("This record failed to boot. Not messing with its saved data")
				}
			}
		)
	}
	_passwordController_EventName_willDeconstructBootedStateAndClearPassword()
	{
		const self = this
		self._tearDown_records()
		self.records = []
		self.hasBooted = false
		// now we'll wait for the "did" event ---v before emiting anything like list updated, etc
	}
	passwordController_DeleteEverything(fn)
	{
		const self = this
		const collectionName = self.override_CollectionName()
		self.context.persister.RemoveAllDocuments(
			collectionName, 
			function(err)
			{
				if (err) {
					fn(err) // must call back!
					return
				}
				console.log(`🗑  Deleted all ${collectionName}.`)
				fn() // must call back!
			}
		)
	}
	_passwordController_EventName_didDeconstructBootedStateAndClearPassword()
	{
		const self = this
		{ // manually emit so that the UI updates to empty list after the pw entry screen is shown
			self.__listUpdated_records()
		}
		{ // this will re-request the pw and lead to loading records & booting self 
			self._tryToBoot()
		}
	}
}
module.exports = ListBaseController